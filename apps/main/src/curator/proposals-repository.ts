import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SkillProposal, SkillProposalKind, SkillProposalStatus } from "@prospero/shared";

type Row = {
  id: string;
  company_id: string;
  kind: string;
  source_skill_ids: string;
  proposed_name: string | null;
  proposed_description: string | null;
  proposed_body: string | null;
  rationale: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: number | null;
  reject_reason: string | null;
  created_at: number;
  source_versions_json: string | null;
};

const toProposal = (r: Row): SkillProposal => ({
  id: r.id,
  companyId: r.company_id,
  kind: r.kind as SkillProposalKind,
  sourceSkillIds: JSON.parse(r.source_skill_ids) as string[],
  proposedName: r.proposed_name,
  proposedDescription: r.proposed_description,
  proposedBody: r.proposed_body,
  rationale: r.rationale,
  status: r.status as SkillProposalStatus,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  rejectReason: r.reject_reason,
  createdAt: r.created_at,
  sourceVersions:
    r.source_versions_json !== null && r.source_versions_json !== undefined
      ? (JSON.parse(r.source_versions_json) as Record<string, number>)
      : null,
});

export type CreateProposalInput = {
  companyId: string;
  kind: SkillProposalKind;
  sourceSkillIds: string[];
  proposedName?: string | null;
  proposedDescription?: string | null;
  proposedBody?: string | null;
  rationale: string;
  // Snapshot of each source skill's version at proposal creation time. Optional
  // so callers that don't yet track it can omit it (stored as null).
  sourceVersions?: Record<string, number> | null;
};

export type ProposalsRepository = {
  create(input: CreateProposalInput): SkillProposal;
  getById(id: string): SkillProposal | null;
  listPending(companyId: string): SkillProposal[];
  updateStatus(
    id: string,
    status: "accepted" | "rejected",
    reviewedBy: string,
    rejectReason?: string,
  ): SkillProposal;
};

export const createProposalsRepository = (db: Database.Database): ProposalsRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO skill_proposals (
      id, company_id, kind, source_skill_ids, proposed_name, proposed_description,
      proposed_body, rationale, status, reviewed_by, reviewed_at, reject_reason, created_at,
      source_versions_json
    ) VALUES (
      @id, @companyId, @kind, @sourceSkillIds, @proposedName, @proposedDescription,
      @proposedBody, @rationale, 'pending', NULL, NULL, NULL, @createdAt,
      @sourceVersionsJson
    )
  `);
  const byId = db.prepare("SELECT * FROM skill_proposals WHERE id = ?");
  const pending = db.prepare(
    "SELECT * FROM skill_proposals WHERE company_id = ? AND status = 'pending' ORDER BY created_at DESC",
  );
  const updateStatusStmt = db.prepare(
    "UPDATE skill_proposals SET status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ? WHERE id = ?",
  );
  const getById = (id: string): SkillProposal | null => {
    const row = byId.get(id) as Row | undefined;
    return row === undefined ? null : toProposal(row);
  };
  return {
    create(input) {
      const id = `prop_${randomUUID()}`;
      insertStmt.run({
        id,
        companyId: input.companyId,
        kind: input.kind,
        sourceSkillIds: JSON.stringify(input.sourceSkillIds),
        proposedName: input.proposedName ?? null,
        proposedDescription: input.proposedDescription ?? null,
        proposedBody: input.proposedBody ?? null,
        rationale: input.rationale,
        createdAt: Date.now(),
        sourceVersionsJson:
          input.sourceVersions != null ? JSON.stringify(input.sourceVersions) : null,
      });
      return getById(id)!;
    },
    getById,
    listPending(companyId) {
      return (pending.all(companyId) as Row[]).map(toProposal);
    },
    updateStatus(id, status, reviewedBy, rejectReason) {
      if ((byId.get(id) as Row | undefined) === undefined)
        throw new Error(`skill proposal not found: ${id}`);
      updateStatusStmt.run(status, reviewedBy, Date.now(), rejectReason ?? null, id);
      return getById(id)!;
    },
  };
};
