import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Approval, ApprovalKind, ApprovalStatus, ToolCallPayload } from "./types.js";

type Row = {
  id: string;
  agent_id: string | null;
  kind: string;
  payload_json: string;
  status: string;
  decided_by: string | null;
  decision_note: string | null;
  created_at: number;
  resolved_at: number | null;
};

const rowToApproval = (r: Row): Approval => ({
  id: r.id,
  agentId: r.agent_id,
  kind: r.kind as ApprovalKind,
  payloadJson: r.payload_json,
  status: r.status as ApprovalStatus,
  decidedBy: r.decided_by,
  decisionNote: r.decision_note,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

export type CreateApprovalInput = {
  agentId: string;
  kind: ApprovalKind;
  payload: ToolCallPayload | Record<string, unknown>;
};

export type ApprovalsRepository = {
  create(input: CreateApprovalInput): Approval;
  getById(id: string): Approval | null;
  decide(
    id: string,
    status: Exclude<ApprovalStatus, "pending">,
    decidedBy: string,
    note?: string,
  ): void;
  findPendingByToolUseId(toolUseId: string): Approval | null;
  listByAgent(agentId: string): Approval[];
};

export const createApprovalsRepository = (db: Database.Database): ApprovalsRepository => {
  const insert = db.prepare(
    `INSERT INTO approvals (id, agent_id, kind, payload_json, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  );
  const byId = db.prepare("SELECT * FROM approvals WHERE id = ?");
  const decideStmt = db.prepare(
    `UPDATE approvals SET status = ?, decided_by = ?, decision_note = ?, resolved_at = ?
     WHERE id = ?`,
  );
  const findByToolUse = db.prepare(
    `SELECT * FROM approvals WHERE status = 'pending' AND payload_json LIKE ? LIMIT 1`,
  );
  const listAgent = db.prepare(
    "SELECT * FROM approvals WHERE agent_id = ? ORDER BY created_at DESC",
  );

  return {
    create(input) {
      const id = `apv_${randomUUID()}`;
      const payloadJson = JSON.stringify(input.payload);
      insert.run(id, input.agentId, input.kind, payloadJson, Date.now());
      const row = byId.get(id) as Row;
      return rowToApproval(row);
    },
    getById(id) {
      const r = byId.get(id) as Row | undefined;
      return r === undefined ? null : rowToApproval(r);
    },
    decide(id, status, decidedBy, note) {
      decideStmt.run(status, decidedBy, note ?? null, Date.now(), id);
    },
    findPendingByToolUseId(toolUseId) {
      const r = findByToolUse.get(`%${toolUseId}%`) as Row | undefined;
      return r === undefined ? null : rowToApproval(r);
    },
    listByAgent(agentId) {
      return (listAgent.all(agentId) as Row[]).map(rowToApproval);
    },
  };
};
