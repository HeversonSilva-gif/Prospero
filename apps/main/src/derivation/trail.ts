import type Database from "better-sqlite3";

export type TrailEntry = { sender: string; content: string };

export type IssueTrail = {
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  comments: TrailEntry[];
};

export type RecoveryTrail = {
  agentId: string;
  agentName: string;
  role: string;
  messages: TrailEntry[];
};

type IssueRow = { identifier: string | null; title: string; description: string | null };
type CommentRow = { sender_kind: string; content: string };
type AgentRow = { name: string; role: string };
type MessageRow = { sender_kind: string; content: string };

// Assembles the trail for an `issue.done` derivation: the issue plus its
// comment thread oldest-first. Returns null if the issue no longer exists.
export const buildIssueTrail = (db: Database.Database, issueId: string): IssueTrail | null => {
  const issue = db
    .prepare("SELECT identifier, title, description FROM issues WHERE id = ?")
    .get(issueId) as IssueRow | undefined;
  if (issue === undefined) return null;
  const comments = db
    .prepare(
      "SELECT sender_kind, content FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC",
    )
    .all(issueId) as CommentRow[];
  return {
    issueId,
    identifier: issue.identifier ?? issueId,
    title: issue.title,
    description: issue.description ?? "",
    comments: comments.map((c) => ({ sender: c.sender_kind, content: c.content })),
  };
};

// Assembles the trail for an `agent.recovered` derivation: the agent's most
// recent messages across threads it participates in, returned oldest-first.
export const buildRecoveryTrail = (
  db: Database.Database,
  agentId: string,
  limit: number,
): RecoveryTrail | null => {
  const agent = db.prepare("SELECT name, role FROM agents WHERE id = ?").get(agentId) as
    | AgentRow
    | undefined;
  if (agent === undefined) return null;
  const rows = db
    .prepare(
      `SELECT m.sender_kind AS sender_kind, m.content AS content
         FROM messages m
         JOIN threads t ON t.id = m.thread_id
        WHERE t.participants_json LIKE '%' || ? || '%'
        ORDER BY m.created_at DESC
        LIMIT ?`,
    )
    .all(agentId, limit) as MessageRow[];
  return {
    agentId,
    agentName: agent.name,
    role: agent.role,
    messages: rows.reverse().map((m) => ({ sender: m.sender_kind, content: m.content })),
  };
};
