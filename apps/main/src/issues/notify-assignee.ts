import { BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { IPC, type Issue } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import { createMessagesRepository } from "../messages/repository.js";

// Wakes the assignee agent for an issue: persists a [user, assignee] message,
// broadcasts it to the renderer, and writes an `agent.deliver` event file the
// orchestrator watcher consumes to enqueue the wake into the agent's stdin.
// Extracted from issues-handlers so BOTH the renderer IPC path AND the MAIN
// consumer of the MCP `issue.updated`/`issue.created` event can wake an agent
// (the agent path could not before — assigned issues just sat idle). Audit
// 2026-06-03 C6 / topo-unlock on the autonomous path.
export const notifyAssignee = (db: Database.Database, eventsDir: string, issue: Issue): void => {
  if (issue.assigneeId === null) return;
  const agents = createAgentsRepository(db);
  const assignee = agents.getById(issue.assigneeId);
  if (assignee === null) {
    console.error(`[issues] notifyAssignee: agent ${issue.assigneeId} not found`);
    return;
  }

  const priority = issue.priority.toUpperCase();
  const lines = [
    `[issue assigned] ${issue.title}`,
    `Priority: ${priority} · Status: ${issue.status} · ID: ${issue.id}`,
  ];
  if (issue.description !== null && issue.description.trim() !== "") {
    lines.push("", issue.description);
  }
  lines.push("", "Use check_status / update_issue / list_issues to work on it.");
  const content = lines.join("\n");

  const msg = createMessagesRepository(db).append({
    companyId: issue.companyId,
    participants: ["user", assignee.id],
    senderKind: "user",
    senderId: null,
    content,
  });
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, {
      kind: "message-append",
      agentId: assignee.id,
      message: { ...msg, threadParticipants: ["user", assignee.id].sort() },
    });
  }

  try {
    writeFileSync(
      join(eventsDir, `${Date.now()}_${randomUUID()}.json`),
      JSON.stringify({
        kind: "agent.deliver",
        agentId: assignee.id,
        companyId: issue.companyId,
        payload: {
          targetId: assignee.id,
          threadId: msg.threadId,
          senderKind: "user",
          senderId: null,
          senderName: "User",
          content,
        },
      }),
      "utf8",
    );
  } catch (e) {
    console.error(`[issues] failed to write wake-up event: ${(e as Error).message}`);
  }
};
