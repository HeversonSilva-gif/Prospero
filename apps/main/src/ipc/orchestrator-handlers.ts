import { ipcMain, BrowserWindow, app } from "electron";
import type Database from "better-sqlite3";
import {
  IPC,
  type Agent,
  type AgentEvent,
  type Message,
  type ToolCallView,
} from "@dashboard-agent/shared";
import { redactString } from "../auth/token-redact.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createMessagesRepository } from "../messages/repository.js";
import { loadDecryptedToken } from "../auth/token-storage.js";
import { ensureRunner, getRunner, removeRunner } from "../orchestrator/lifecycle.js";
import { createRouter } from "../orchestrator/router.js";
import type { Sender } from "../orchestrator/router.js";
import type { ParsedEvent } from "../orchestrator/stream-parser.js";
import { databasePath } from "../db/path.js";
import { getPermissionsDir } from "../security/permissions-dir.js";

const broadcast = (event: AgentEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, event);
  }
};

export const registerOrchestratorHandlers = (db: Database.Database): void => {
  const agents = createAgentsRepository(db);
  const messages = createMessagesRepository(db);

  const router = createRouter({
    writeStdin: (agentId, content) => {
      const r = getRunner(agentId);
      if (r !== undefined && r.isAlive()) r.send(content);
    },
  });

  const ensureAgentRunner = (agent: Agent): void => {
    const existing = getRunner(agent.id);
    if (existing !== undefined && existing.isAlive()) return;

    const token = loadDecryptedToken(db);
    if (token === null) throw new Error("OAuth token not configured");

    const collectedToolCalls = new Map<string, ToolCallView>();

    ensureRunner(
      {
        agent,
        oauthToken: token,
        userDataDir: app.getPath("userData"),
        dbPath: databasePath(),
        permissionsDir: getPermissionsDir(app.getPath("userData")),
      },
      {
        onEvent: (ev: ParsedEvent) => {
          if (ev.kind === "session-init") {
            agents.setSessionId(agent.id, ev.sessionId);
            broadcast({ kind: "session", agentId: agent.id, sessionId: ev.sessionId });
            agents.updateStatus(agent.id, { status: "thinking", currentAction: null });
            broadcast({
              kind: "status",
              agentId: agent.id,
              status: "thinking",
              currentAction: null,
            });
          } else if (ev.kind === "assistant-message") {
            let textContent = "";
            const tools: ToolCallView[] = [];
            for (const block of ev.blocks) {
              if (block.kind === "text") {
                textContent += block.text;
              } else {
                const tc: ToolCallView = {
                  id: block.id,
                  name: block.name,
                  input: block.input,
                  status: "pending",
                  result: null,
                };
                tools.push(tc);
                collectedToolCalls.set(block.id, tc);
                agents.updateStatus(agent.id, {
                  status: "working",
                  currentAction: `Using ${block.name}`.slice(0, 80),
                });
                broadcast({
                  kind: "status",
                  agentId: agent.id,
                  status: "working",
                  currentAction: `Using ${block.name}`.slice(0, 80),
                });
              }
            }
            const threadId = router.getCurrentThread(agent.id);
            if (threadId !== null && (textContent !== "" || tools.length > 0)) {
              const m = messages.appendToThreadId({
                threadId,
                senderKind: "agent",
                senderId: agent.id,
                content: textContent,
                toolCalls: tools.length > 0 ? tools : null,
              });
              broadcast({ kind: "message-append", agentId: agent.id, message: m });
            }
          } else if (ev.kind === "tool-result") {
            const existing = collectedToolCalls.get(ev.toolUseId);
            if (existing !== undefined) {
              existing.status = ev.isError ? "error" : "success";
              existing.result = ev.content;
              broadcast({
                kind: "tool-result",
                agentId: agent.id,
                threadId: router.getCurrentThread(agent.id) ?? "",
                toolCallId: ev.toolUseId,
                result: ev.content,
              });
            }
          } else if (ev.kind === "turn-complete") {
            collectedToolCalls.clear();
            router.onTurnComplete(agent.id);
            const stillBusy = router.getCurrentThread(agent.id) !== null;
            const status = stillBusy ? "thinking" : "idle";
            agents.updateStatus(agent.id, { status, currentAction: null });
            broadcast({ kind: "status", agentId: agent.id, status, currentAction: null });
          } else if (ev.kind === "api-retry") {
            broadcast({
              kind: "error",
              agentId: agent.id,
              message: `API retry attempt ${String(ev.attempt)}: ${ev.error}`,
            });
          }
        },
        onStderr: (line: string) => {
          try {
            const parsed: unknown = JSON.parse(line);
            if (
              parsed !== null &&
              typeof parsed === "object" &&
              typeof (parsed as { kind?: unknown }).kind === "string"
            ) {
              const k = (parsed as { kind: string }).kind;
              const payloadObj = (parsed as { payload?: unknown }).payload;
              if (k === "agent.deliver" && typeof payloadObj === "object" && payloadObj !== null) {
                const p = payloadObj as {
                  targetId: string;
                  threadId: string;
                  senderName: string;
                  senderId: string;
                  content: string;
                };
                const target = agents.getById(p.targetId);
                if (target !== null) {
                  ensureAgentRunner(target);
                  const sender: Sender = {
                    kind: "agent",
                    id: p.senderId,
                    name: p.senderName,
                  };
                  router.enqueue(p.targetId, p.threadId, p.content, sender);
                }
              } else if (
                k === "agent.kill" &&
                typeof payloadObj === "object" &&
                payloadObj !== null
              ) {
                const p = payloadObj as { agentId: string };
                const r = getRunner(p.agentId);
                r?.kill();
                removeRunner(p.agentId);
              }
            }
          } catch {
            console.error(`[claude:${agent.id}] stderr: ${redactString(line)}`);
          }
        },
        onExit: (code) => {
          console.error(`[claude:${agent.id}] exit code: ${String(code)}`);
          removeRunner(agent.id);
          if (code !== 0) {
            agents.clearSessionId(agent.id);
          }
          agents.updateStatus(agent.id, {
            status: code === 0 ? "idle" : "error",
            currentAction: null,
          });
          broadcast({
            kind: "status",
            agentId: agent.id,
            status: code === 0 ? "idle" : "error",
            currentAction: null,
          });
        },
        onError: (err) => {
          console.error(`[claude:${agent.id}] spawn error: ${err.message}`);
          removeRunner(agent.id);
          agents.clearSessionId(agent.id);
          agents.updateStatus(agent.id, { status: "error", currentAction: null });
          broadcast({
            kind: "error",
            agentId: agent.id,
            message: err.message,
          });
          broadcast({
            kind: "status",
            agentId: agent.id,
            status: "error",
            currentAction: null,
          });
        },
      },
    );
  };

  ipcMain.handle(IPC.AGENT_LIST, (_e, payload: { companyId: string }): Agent[] =>
    agents.listByCompany(payload.companyId),
  );

  ipcMain.handle(IPC.AGENT_KILL, (_e, payload: { agentId: string }): void => {
    const runner = getRunner(payload.agentId);
    runner?.kill();
    removeRunner(payload.agentId);
    agents.updateStatus(payload.agentId, { status: "idle", currentAction: null });
  });

  ipcMain.handle(
    IPC.AGENT_SEND_MESSAGE,
    (_e, payload: { agentId: string; content: string }): Promise<Message> => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");

      const userMessage = messages.append({
        companyId: agent.companyId,
        participants: ["user", agent.id],
        senderKind: "user",
        senderId: null,
        content: payload.content,
      });
      broadcast({ kind: "message-append", agentId: agent.id, message: userMessage });

      ensureAgentRunner(agent);
      router.enqueue(agent.id, userMessage.threadId, payload.content, {
        kind: "user",
        id: null,
        name: "User",
      });
      return Promise.resolve(userMessage);
    },
  );
};
