import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { IssueComment } from "@dashboard-agent/shared";

type Row = {
  id: string;
  issue_id: string;
  sender_kind: string;
  sender_id: string | null;
  content: string;
  created_at: number;
};

const rowToComment = (r: Row): IssueComment => ({
  id: r.id,
  issueId: r.issue_id,
  senderKind: r.sender_kind as "user" | "agent",
  senderId: r.sender_id,
  content: r.content,
  createdAt: r.created_at,
});

export type AddCommentInput = {
  issueId: string;
  senderKind: "user" | "agent";
  senderId: string | null;
  content: string;
};

export type IssueCommentsRepository = {
  add(input: AddCommentInput): IssueComment;
  listByIssue(issueId: string): IssueComment[];
};

export const createIssueCommentsRepository = (db: Database.Database): IssueCommentsRepository => {
  const insert = db.prepare(
    "INSERT INTO issue_comments (id, issue_id, sender_kind, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const byIssue = db.prepare(
    "SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC",
  );
  const byId = db.prepare("SELECT * FROM issue_comments WHERE id = ?");

  return {
    add(input) {
      const id = `cmt_${randomUUID()}`;
      insert.run(id, input.issueId, input.senderKind, input.senderId, input.content, Date.now());
      return rowToComment(byId.get(id) as Row);
    },
    listByIssue(issueId) {
      return (byIssue.all(issueId) as Row[]).map(rowToComment);
    },
  };
};
