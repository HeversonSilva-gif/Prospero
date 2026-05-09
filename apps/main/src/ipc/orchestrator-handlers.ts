import { ipcMain, BrowserWindow } from "electron";
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
import { createInboxRepository } from "../inbox/repository.js";
import { loadDecryptedToken } from "../auth/token-storage.js";
import { spawnAgent, getRunner, registerRunner, removeRunner } from "../orchestrator/lifecycle.js";
import type { ParsedEvent } from "../orchestrator/stream-parser.js";

const broadcast = (event: AgentEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, event);
  }
};

export const registerOrchestratorHandlers = (db: Database.Database): void => {
  const agents = createAgentsRepository(db);
  const messages = createMessagesRepository(db);
  const inbox = createInboxRepository(db);

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

      let runner = getRunner(agent.id);
      if (runner === undefined) {
        const token = loadDecryptedToken(db);
        if (token === null) throw new Error("OAuth token not configured");
        const collectedToolCalls = new Map<string, ToolCallView>();
        let assistantTextBuffer = "";

        runner = spawnAgent(
          { agent, oauthToken: token },
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
              } else if (ev.kind === "tool-use-start") {
                const tc: ToolCallView = {
                  id: ev.toolUseId,
                  name: ev.name,
                  input: ev.input,
                  status: "pending",
                  result: null,
                };
                collectedToolCalls.set(ev.toolUseId, tc);
                broadcast({
                  kind: "tool-call",
                  agentId: agent.id,
                  threadId: userMessage.threadId,
                  tool: tc,
                });
              } else if (ev.kind === "tool-result") {
                const existing = collectedToolCalls.get(ev.toolUseId);
                if (existing !== undefined) {
                  existing.status = "success";
                  existing.result = ev.content;
                  broadcast({
                    kind: "tool-result",
                    agentId: agent.id,
                    threadId: userMessage.threadId,
                    toolCallId: ev.toolUseId,
                    result: ev.content,
                  });
                }
              } else if (ev.kind === "text-delta") {
                assistantTextBuffer += ev.text;
              } else if (ev.kind === "message-stop") {
                if (assistantTextBuffer.trim() !== "" || collectedToolCalls.size > 0) {
                  const tools =
                    collectedToolCalls.size > 0 ? Array.from(collectedToolCalls.values()) : null;
                  const m = messages.append({
                    companyId: agent.companyId,
                    participants: ["user", agent.id],
                    senderKind: "agent",
                    senderId: agent.id,
                    content: assistantTextBuffer,
                    toolCalls: tools,
                  });
                  broadcast({ kind: "message-append", agentId: agent.id, message: m });
                  assistantTextBuffer = "";
                  collectedToolCalls.clear();
                }
                agents.updateStatus(agent.id, { status: "idle", currentAction: null });
                broadcast({
                  kind: "status",
                  agentId: agent.id,
                  status: "idle",
                  currentAction: null,
                });
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
                  if (k.endsWith(".called")) {
                    const payloadObj = (parsed as { payload?: unknown }).payload;
                    inbox.create({
                      companyId: agent.companyId,
                      kind: "completed",
                      actorId: agent.id,
                      title: `Tool ${k.replace(".called", "")} called`,
                      preview:
                        typeof payloadObj === "object" && payloadObj !== null
                          ? JSON.stringify(payloadObj).slice(0, 200)
                          : null,
                      requiresAction: false,
                    });
                  }
                }
              } catch {
                // not JSON — likely a claude diagnostic. Log it (redacted) so we can
                // diagnose subprocess errors during M3 manual testing.
                console.error(`[claude:${agent.id}] stderr: ${redactString(line)}`);
              }
            },
            onExit: (code) => {
              console.error(`[claude:${agent.id}] exit code: ${String(code)}`);
              removeRunner(agent.id);
              // On non-zero exit, clear session id so next attempt starts fresh instead of
              // trying --resume with a possibly invalid session.
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
              agents.updateStatus(agent.id, {
                status: "error",
                currentAction: null,
              });
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
        registerRunner(runner);
      }

      runner.send(payload.content);
      return Promise.resolve(userMessage);
    },
  );
};
