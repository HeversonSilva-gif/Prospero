import { ipcMain, app, BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  IPC,
  type AgentEvent,
  type Issue,
  type IssueArtifact,
  type IssueDetail,
  type IssueComment,
  type IssueStatus,
  type IssuePriority,
} from "@dashboard-agent/shared";
import { createIssuesRepository } from "../issues/repository.js";
import { createIssueCommentsRepository } from "../issues/comments-repository.js";
import { createArtifactsRepository } from "../artifacts/repository.js";
import { createMessagesRepository } from "../messages/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { getEventsDir } from "../orchestrator/events-dir.js";
import { broadcastIssueChanged } from "./issue-events-broadcast.js";

const broadcast = (event: AgentEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, event);
  }
};

export const registerIssuesHandlers = (db: Database.Database): void => {
  const issues = createIssuesRepository(db);
  const comments = createIssueCommentsRepository(db);
  const messages = createMessagesRepository(db);
  const agents = createAgentsRepository(db, tryGetRecorder());
  const eventsDir = getEventsDir(app.getPath("userData"));

  // Wake the assignee agent when an issue is created or reassigned to them.
  // Persists a user-authored message in the [user, assignee] thread and writes
  // an `agent.deliver` event file so the orchestrator's watcher enqueues the
  // wake-up into the agent's stdin. Without this, an assigned issue just sits
  // in the board with no one acting on it.
  const notifyAssignee = (issue: Issue): void => {
    if (issue.assigneeId === null) return;
    const assignee = agents.getById(issue.assigneeId);
    if (assignee === null) {
      console.error(`[issues] notifyAssignee: agent ${issue.assigneeId} not found`);
      return;
    }
    console.log(
      `[issues] notifyAssignee: waking ${assignee.name} for issue ${issue.id} (${issue.title})`,
    );

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

    const msg = messages.append({
      companyId: issue.companyId,
      participants: ["user", assignee.id],
      senderKind: "user",
      senderId: null,
      content,
    });
    broadcast({ kind: "message-append", agentId: assignee.id, message: msg });

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

  ipcMain.handle(
    IPC.ISSUES_LIST,
    (
      _e,
      payload: { companyId: string; projectId?: string; assigneeId?: string; status?: IssueStatus },
    ): Issue[] => issues.list(payload),
  );

  ipcMain.handle(IPC.ISSUES_GET, (_e, payload: { id: string }): IssueDetail | null =>
    issues.getDetail(payload.id),
  );

  ipcMain.handle(
    IPC.ISSUES_CREATE,
    (
      _e,
      payload: {
        companyId: string;
        projectId: string | null;
        title: string;
        description?: string | null;
        assigneeId?: string | null;
        priority?: IssuePriority;
        parentId?: string | null;
      },
    ): Issue => {
      const i = issues.create(
        {
          companyId: payload.companyId,
          projectId: payload.projectId,
          title: payload.title,
          description: payload.description ?? null,
          assigneeId: payload.assigneeId ?? null,
          priority: payload.priority ?? "medium",
          parentId: payload.parentId ?? null,
          createdBy: null,
        },
        { actorKind: "user", actorId: null },
      );
      broadcastIssueChanged({ kind: "created", issueId: i.id, companyId: i.companyId });
      notifyAssignee(i);
      return i;
    },
  );

  ipcMain.handle(
    IPC.ISSUES_UPDATE,
    (
      _e,
      payload: {
        id: string;
        title?: string;
        description?: string | null;
        status?: IssueStatus;
        assigneeId?: string | null;
        priority?: IssuePriority;
        parentId?: string | null;
      },
    ): Issue | null => {
      const { id, ...patch } = payload;
      const prev = issues.getById(id);
      const next = issues.update(id, patch, { actorKind: "user", actorId: null });
      if (next !== null) {
        broadcastIssueChanged({ kind: "updated", issueId: next.id, companyId: next.companyId });
        // Wake the assignee only when the assignment transitions to a new agent
        // (was null, was a different agent, or update explicitly set assignee
        // for the first time).
        const reassigned =
          next.assigneeId !== null &&
          (prev === null || prev.assigneeId !== next.assigneeId) &&
          patch.assigneeId !== undefined;
        if (reassigned) notifyAssignee(next);
      }
      return next;
    },
  );

  ipcMain.handle(IPC.ISSUES_DELETE, (_e, payload: { id: string }): { ok: true } => {
    const issue = issues.getById(payload.id);
    issues.delete(payload.id);
    if (issue !== null)
      broadcastIssueChanged({
        kind: "deleted",
        issueId: payload.id,
        companyId: issue.companyId,
      });
    return { ok: true };
  });

  ipcMain.handle(
    IPC.ISSUES_ADD_COMMENT,
    (_e, payload: { issueId: string; content: string }): IssueComment => {
      const c = comments.add({
        issueId: payload.issueId,
        senderKind: "user",
        senderId: null,
        content: payload.content,
      });
      const issue = issues.getById(payload.issueId);
      if (issue !== null)
        broadcastIssueChanged({
          kind: "comment-added",
          issueId: c.issueId,
          companyId: issue.companyId,
        });
      return c;
    },
  );

  const artifacts = createArtifactsRepository(db);
  ipcMain.handle(IPC.ARTIFACTS_LIST_BY_ISSUE, (_e, payload: { issueId: string }): IssueArtifact[] =>
    artifacts.listByIssue(payload.issueId),
  );
};
