import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import {
  IPC,
  type Issue,
  type IssueDetail,
  type IssueComment,
  type IssueStatus,
  type IssuePriority,
} from "@dashboard-agent/shared";
import { createIssuesRepository } from "../issues/repository.js";
import { createIssueCommentsRepository } from "../issues/comments-repository.js";
import { broadcastIssueChanged } from "./issue-events-broadcast.js";

export const registerIssuesHandlers = (db: Database.Database): void => {
  const issues = createIssuesRepository(db);
  const comments = createIssueCommentsRepository(db);

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
      const next = issues.update(id, patch, { actorKind: "user", actorId: null });
      if (next !== null)
        broadcastIssueChanged({ kind: "updated", issueId: next.id, companyId: next.companyId });
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
};
