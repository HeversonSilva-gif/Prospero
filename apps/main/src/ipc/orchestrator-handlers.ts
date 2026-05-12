import { ipcMain, BrowserWindow, app } from "electron";
import type Database from "better-sqlite3";
import {
  IPC,
  MODEL_ID_REGEX,
  type Agent,
  type AgentEvent,
  type AgentStats,
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
import type { ParsedEvent } from "@dashboard-agent/shared";
import { databasePath } from "../db/path.js";
import { getPermissionsDir } from "../security/permissions-dir.js";
import { getEventsDir } from "../orchestrator/events-dir.js";
import {
  startEventsWatcher,
  type AgentEvent as AgentSideEvent,
} from "../orchestrator/events-watcher.js";
import { broadcastIssueChanged } from "./issue-events-broadcast.js";

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

  // Dispatch agent-emitted side-channel events (inter-agent delivery, hire/fire,
  // issue notifications). Called from the file-based events watcher; previously
  // ran inside the per-agent onStderr handler but stderr forwarding from the MCP
  // child through claude is unreliable on Windows.
  const dispatchAgentEvent = (event: AgentSideEvent): void => {
    const { kind, companyId, payload } = event;
    if (kind === "agent.deliver" && typeof payload === "object" && payload !== null) {
      const p = payload as {
        targetId: string;
        threadId: string;
        senderName: string;
        senderId: string | null;
        senderKind?: "user" | "agent";
        content: string;
      };
      const target = agents.getById(p.targetId);
      if (target === null) return;
      ensureAgentRunner(target);
      const sender: Sender = {
        kind: p.senderKind ?? "agent",
        id: p.senderId,
        name: p.senderName,
      };
      router.enqueue(p.targetId, p.threadId, p.content, sender);
    } else if (kind === "agent.kill" && typeof payload === "object" && payload !== null) {
      const p = payload as { agentId: string };
      const r = getRunner(p.agentId);
      r?.kill();
      removeRunner(p.agentId);
      broadcast({ kind: "roster-changed", companyId });
    } else if (kind === "agent.spawn-needed") {
      broadcast({ kind: "roster-changed", companyId });
    } else if (kind === "user.message-append" && typeof payload === "object" && payload !== null) {
      // report_to_user appended a message to the agent's user thread but
      // can't broadcast directly from the MCP child. Re-broadcast here so
      // the renderer's message-append listener refetches and shows it.
      const p = payload as { agentId: string; messageId: string };
      const row = db
        .prepare(
          `SELECT m.id, m.thread_id, m.sender_kind, m.sender_id, m.content,
                  m.tool_calls_json, m.created_at FROM messages m WHERE m.id = ?`,
        )
        .get(p.messageId) as
        | {
            id: string;
            thread_id: string;
            sender_kind: string;
            sender_id: string | null;
            content: string;
            tool_calls_json: string | null;
            created_at: number;
          }
        | undefined;
      if (row !== undefined) {
        broadcast({
          kind: "message-append",
          agentId: p.agentId,
          message: {
            id: row.id,
            threadId: row.thread_id,
            senderKind: row.sender_kind as "agent" | "user" | "system",
            senderId: row.sender_id,
            content: row.content,
            toolCalls:
              row.tool_calls_json === null
                ? null
                : (JSON.parse(row.tool_calls_json) as ToolCallView[]),
            createdAt: row.created_at,
          },
        });
      }
    } else if (
      (kind === "issue.created" || kind === "issue.updated") &&
      typeof payload === "object" &&
      payload !== null
    ) {
      const p = payload as { issueId: string };
      const issueRow = db.prepare("SELECT company_id FROM issues WHERE id = ?").get(p.issueId) as
        | { company_id: string }
        | undefined;
      if (issueRow !== undefined) {
        broadcastIssueChanged({
          kind: kind === "issue.created" ? "created" : "updated",
          issueId: p.issueId,
          companyId: issueRow.company_id,
        });
      }
    }
  };

  const eventsDir = getEventsDir(app.getPath("userData"));
  void startEventsWatcher({ dir: eventsDir, onEvent: dispatchAgentEvent });

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
        eventsDir,
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
            // Refresh agents roster on every turn-complete. Covers the case where this
            // turn called hire_agent/fire_agent and the renderer needs to see the new
            // sidebar state. stderr-based agent.spawn-needed events don't always reach
            // us through claude's stdio pipes on Windows, so this is the reliable path.
            broadcast({ kind: "roster-changed", companyId: agent.companyId });
          } else if (ev.kind === "api-retry") {
            broadcast({
              kind: "error",
              agentId: agent.id,
              message: `API retry attempt ${String(ev.attempt)}: ${ev.error}`,
            });
          }
        },
        onStderr: (line: string) => {
          // Agent-emitted side-channel events now flow via file-based watcher
          // (see startEventsWatcher above). Stderr is only used for diagnostic
          // text from claude itself; log it.
          console.error(`[claude:${agent.id}] stderr: ${redactString(line)}`);
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

  // Restart helper for config mutations. Trocar --model / --allowedTools /
  // --system-prompt exige re-spawn (claude lê esses args só na inicialização).
  // Kills runner if alive, zera claude_session_id pra próxima mensagem não
  // tentar --resume com session stale, e broadcast roster pra UI re-render.
  const restartIfRunning = (agentId: string, companyId: string): void => {
    const runner = getRunner(agentId);
    if (runner !== undefined && runner.isAlive()) {
      runner.kill();
      removeRunner(agentId);
    }
    agents.clearSessionId(agentId);
    agents.updateStatus(agentId, { status: "idle", currentAction: null });
    broadcast({ kind: "roster-changed", companyId });
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
    IPC.AGENTS_SET_ALLOWED_PROJECTS,
    (_e, payload: { agentId: string; projectIds: string[] }): void => {
      agents.setAllowedProjects(payload.agentId, payload.projectIds);
    },
  );

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

  ipcMain.handle(
    IPC.AGENTS_SET_MODEL,
    (_e, payload: { agentId: string; model: string }): { ok: true } => {
      // Defense-in-depth: re-validate model id even though renderer also validates.
      // Prevents shell-injection via --model arg if the renderer is bypassed.
      if (!MODEL_ID_REGEX.test(payload.model)) throw new Error("Invalid model id");
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setModel(payload.agentId, payload.model);
      restartIfRunning(payload.agentId, agent.companyId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_ROLE,
    (
      _e,
      payload: { agentId: string; roleTemplateId: string; preserveModel?: boolean },
    ): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setRole(payload.agentId, payload.roleTemplateId, {
        preserveModel: payload.preserveModel === true,
      });
      restartIfRunning(payload.agentId, agent.companyId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_SYSTEM_PROMPT,
    (_e, payload: { agentId: string; systemPrompt: string }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setSystemPrompt(payload.agentId, payload.systemPrompt);
      restartIfRunning(payload.agentId, agent.companyId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_REPORTS_TO,
    (_e, payload: { agentId: string; reportsTo: string | null }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setReportsTo(payload.agentId, payload.reportsTo);
      // reports_to é metadata visual; não afeta spawn args → não precisa restart.
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.AGENTS_STATS, (_e, payload: { agentId: string }): AgentStats => {
    const row = db
      .prepare(
        `SELECT COUNT(*) as n, MAX(created_at) as last
         FROM messages WHERE sender_kind = 'agent' AND sender_id = ?`,
      )
      .get(payload.agentId) as { n: number; last: number | null };
    return {
      turns: row.n,
      tokensIn: null,
      tokensOut: null,
      lastActivityAt: row.last,
    };
  });
};
