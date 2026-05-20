import type Database from "better-sqlite3";
import { createIssuesRepository } from "../issues/repository.js";

export type TrailEntry = { sender: string; content: string };

export type TrailCriterion = {
  statement: string;
  kind: "deterministic" | "judgment";
  status: "pending" | "passed" | "failed" | "waived";
  attempts: number;
};

export type IssueTrail = {
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  comments: TrailEntry[];
  criteria: TrailCriterion[]; // empty when the issue is not tied to a goal
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

type CriterionRow = {
  statement: string;
  kind: "deterministic" | "judgment";
  status: "pending" | "passed" | "failed" | "waived";
  attempts: number;
};

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
  const goalId = createIssuesRepository(db).getGoalId(issueId);
  let criteria: TrailCriterion[] = [];
  if (goalId !== null) {
    criteria = db
      .prepare(
        `SELECT gc.statement, gc.kind, gc.status, gc.attempts
         FROM goal_criteria gc
         JOIN issue_criteria ic ON ic.criterion_id = gc.id
         WHERE ic.issue_id = ?
         ORDER BY gc.sort_order`,
      )
      .all(issueId) as CriterionRow[];
  }
  return {
    issueId,
    identifier: issue.identifier ?? issueId,
    title: issue.title,
    description: issue.description ?? "",
    comments: comments.map((c) => ({ sender: c.sender_kind, content: c.content })),
    criteria,
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

export type GoalTrail = {
  title: string;
  description: string;
  successCriteria: string;
  issues: Array<{ title: string; status: string }>;
};

type GoalRow = { title: string; description: string | null; success_criteria: string | null };
type GoalIssueRow = { title: string; status: string };

// Assembles the trail for a `goal.achieved` retrospective: the goal plus the
// issues that were created under it. Returns null if the goal is gone.
export const buildGoalTrail = (db: Database.Database, goalId: string): GoalTrail | null => {
  const goal = db
    .prepare("SELECT title, description, success_criteria FROM goals WHERE id = ?")
    .get(goalId) as GoalRow | undefined;
  if (goal === undefined) return null;
  const issues = db
    .prepare("SELECT title, status FROM issues WHERE goal_id = ? ORDER BY created_at ASC")
    .all(goalId) as GoalIssueRow[];
  return {
    title: goal.title,
    description: goal.description ?? "",
    successCriteria: goal.success_criteria ?? "",
    issues,
  };
};

export type ApprovalTrail = { kind: string; payloadJson: string; note: string };

type ApprovalRow = { kind: string; payload_json: string; decision_note: string | null };

// Assembles the trail for an `approval.rejected` preference derivation: what
// the agent asked to do and why the user said no. Returns null if gone.
export const buildApprovalTrail = (
  db: Database.Database,
  approvalId: string,
): ApprovalTrail | null => {
  const a = db
    .prepare("SELECT kind, payload_json, decision_note FROM approvals WHERE id = ?")
    .get(approvalId) as ApprovalRow | undefined;
  if (a === undefined) return null;
  return { kind: a.kind, payloadJson: a.payload_json, note: a.decision_note ?? "" };
};
