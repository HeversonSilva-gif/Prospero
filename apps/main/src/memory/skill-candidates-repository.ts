import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SkillCandidate, SkillCandidateStatus, SkillCandidateTrigger } from "@prospero/shared";

type SkillCandidateRow = {
  id: string;
  company_id: string;
  agent_id: string;
  source_event_id: string;
  trigger: string;
  proposed_name: string;
  proposed_description: string;
  proposed_body: string;
  proposed_applies_to_role: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: number | null;
  reject_reason: string | null;
  created_at: number;
};

const rowToCandidate = (r: SkillCandidateRow): SkillCandidate => ({
  id: r.id,
  companyId: r.company_id,
  agentId: r.agent_id,
  sourceEventId: r.source_event_id,
  trigger: r.trigger as SkillCandidateTrigger,
  proposedName: r.proposed_name,
  proposedDescription: r.proposed_description,
  proposedBody: r.proposed_body,
  proposedAppliesToRole: r.proposed_applies_to_role,
  status: r.status as SkillCandidateStatus,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  rejectReason: r.reject_reason,
  createdAt: r.created_at,
});

export type CreateSkillCandidateInput = {
  companyId: string;
  agentId: string;
  sourceEventId: string;
  trigger: SkillCandidateTrigger;
  proposedName: string;
  proposedDescription: string;
  proposedBody: string;
  proposedAppliesToRole?: string | null;
};

export type SkillCandidatesRepository = {
  create(input: CreateSkillCandidateInput): SkillCandidate;
  getById(id: string): SkillCandidate | null;
  listPending(companyId: string): SkillCandidate[];
  listPendingByAgent(agentId: string): SkillCandidate[];
  updateStatus(
    id: string,
    status: "accepted" | "rejected",
    reviewedBy: string,
    rejectReason?: string,
  ): SkillCandidate;
};

export const createSkillCandidatesRepository = (
  db: Database.Database,
): SkillCandidatesRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO skill_candidates (
      id, company_id, agent_id, source_event_id, trigger, proposed_name,
      proposed_description, proposed_body, proposed_applies_to_role, status,
      reviewed_by, reviewed_at, reject_reason, created_at
    ) VALUES (
      @id, @companyId, @agentId, @sourceEventId, @trigger, @proposedName,
      @proposedDescription, @proposedBody, @proposedAppliesToRole, 'pending',
      NULL, NULL, NULL, @createdAt
    )
  `);
  const byId = db.prepare("SELECT * FROM skill_candidates WHERE id = ?");
  const pending = db.prepare(
    "SELECT * FROM skill_candidates WHERE company_id = ? AND status = 'pending' ORDER BY created_at DESC",
  );
  const pendingByAgent = db.prepare(
    "SELECT * FROM skill_candidates WHERE agent_id = ? AND status = 'pending' ORDER BY created_at DESC",
  );
  const updateStatusStmt = db.prepare(
    "UPDATE skill_candidates SET status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ? WHERE id = ?",
  );

  const getById = (id: string): SkillCandidate | null => {
    const row = byId.get(id) as SkillCandidateRow | undefined;
    return row === undefined ? null : rowToCandidate(row);
  };

  return {
    create(input) {
      const id = `cand_${randomUUID()}`;
      insertStmt.run({
        id,
        companyId: input.companyId,
        agentId: input.agentId,
        sourceEventId: input.sourceEventId,
        trigger: input.trigger,
        proposedName: input.proposedName,
        proposedDescription: input.proposedDescription,
        proposedBody: input.proposedBody,
        proposedAppliesToRole: input.proposedAppliesToRole ?? null,
        createdAt: Date.now(),
      });
      return getById(id)!;
    },
    getById,
    listPending(companyId) {
      return (pending.all(companyId) as SkillCandidateRow[]).map(rowToCandidate);
    },
    listPendingByAgent(agentId) {
      return (pendingByAgent.all(agentId) as SkillCandidateRow[]).map(rowToCandidate);
    },
    updateStatus(id, status, reviewedBy, rejectReason) {
      const existing = byId.get(id) as SkillCandidateRow | undefined;
      if (existing === undefined) throw new Error(`skill candidate not found: ${id}`);
      updateStatusStmt.run(status, reviewedBy, Date.now(), rejectReason ?? null, id);
      return getById(id)!;
    },
  };
};
