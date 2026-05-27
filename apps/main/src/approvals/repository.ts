import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Approval,
  ApprovalKind,
  ApprovalRoute,
  ApprovalStatus,
  ToolCallPayload,
} from "./types.js";

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
  routed_to: string | null;
  escalated_at: number | null;
  bounce_count: number;
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
  routedTo: (r.routed_to as ApprovalRoute | null) ?? null,
  escalatedAt: r.escalated_at,
  bounceCount: r.bounce_count,
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
  setRouted(id: string, route: ApprovalRoute): void;
  setEscalated(id: string): void;
  listPendingRoutedToCeo(companyId: string): Approval[];
  incrementBounceCount(id: string): void;
  listPendingRoutedToUserForBounce(cutoffCreatedAt: number): Approval[];
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
  const setRoutedStmt = db.prepare("UPDATE approvals SET routed_to = ? WHERE id = ?");
  const setEscalatedStmt = db.prepare("UPDATE approvals SET escalated_at = ? WHERE id = ?");
  const listPendingCeo = db.prepare(
    `SELECT ap.* FROM approvals ap
       JOIN agents ag ON ag.id = ap.agent_id
      WHERE ap.status = 'pending' AND ap.routed_to = 'ceo' AND ag.company_id = ?
      ORDER BY ap.created_at ASC`,
  );
  const incrementBounce = db.prepare(
    "UPDATE approvals SET bounce_count = bounce_count + 1 WHERE id = ?",
  );
  const listStuckForBounce = db.prepare(
    `SELECT * FROM approvals
      WHERE status = 'pending'
        AND routed_to = 'user'
        AND bounce_count = 0
        AND created_at < ?
      ORDER BY created_at ASC`,
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
    setRouted(id, route) {
      setRoutedStmt.run(route, id);
    },
    setEscalated(id) {
      setEscalatedStmt.run(Date.now(), id);
    },
    listPendingRoutedToCeo(companyId) {
      return (listPendingCeo.all(companyId) as Row[]).map(rowToApproval);
    },
    incrementBounceCount(id) {
      incrementBounce.run(id);
    },
    listPendingRoutedToUserForBounce(cutoffCreatedAt) {
      return (listStuckForBounce.all(cutoffCreatedAt) as Row[]).map(rowToApproval);
    },
  };
};
