import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { OrgPlan, OrgPlanStatus, ProposedRole, ProposedAgent } from "@prospero/shared";

export type OrgPlanInsert = {
  companyId: string;
  proposedByAgentId: string;
  summary: string;
  roles: ProposedRole[];
  agents: ProposedAgent[];
};

export type OrgPlansRepository = {
  insert(input: OrgPlanInsert): OrgPlan;
  getById(id: string): OrgPlan | null;
  // The current 'proposed' plan for a company, or null.
  getCurrentForCompany(companyId: string): OrgPlan | null;
  markApproved(id: string): void;
  markRejected(id: string, userFeedback: string | null): void;
  markSuperseded(id: string): void;
};

type Row = {
  id: string;
  company_id: string;
  proposed_by_agent_id: string;
  summary: string;
  roles_json: string;
  agents_json: string;
  status: string;
  user_feedback: string | null;
  proposed_at: number;
  decided_at: number | null;
};

const rowToPlan = (r: Row): OrgPlan => ({
  id: r.id,
  companyId: r.company_id,
  proposedByAgentId: r.proposed_by_agent_id,
  summary: r.summary,
  roles: JSON.parse(r.roles_json) as ProposedRole[],
  agents: JSON.parse(r.agents_json) as ProposedAgent[],
  status: r.status as OrgPlanStatus,
  userFeedback: r.user_feedback,
  proposedAt: r.proposed_at,
  decidedAt: r.decided_at,
});

export const createOrgPlansRepository = (db: Database.Database): OrgPlansRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO org_plans
      (id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
       status, user_feedback, proposed_at, decided_at)
    VALUES
      (@id, @companyId, @proposedByAgentId, @summary, @rolesJson, @agentsJson,
       'proposed', NULL, @proposedAt, NULL)
  `);
  const byIdStmt = db.prepare("SELECT * FROM org_plans WHERE id = ?");
  const currentStmt = db.prepare(
    "SELECT * FROM org_plans WHERE company_id = ? AND status = 'proposed' ORDER BY proposed_at DESC LIMIT 1",
  );
  const approveStmt = db.prepare(
    "UPDATE org_plans SET status = 'approved', decided_at = ? WHERE id = ?",
  );
  const rejectStmt = db.prepare(
    "UPDATE org_plans SET status = 'rejected', decided_at = ?, user_feedback = ? WHERE id = ?",
  );
  const supersedeStmt = db.prepare(
    "UPDATE org_plans SET status = 'superseded', decided_at = ? WHERE id = ?",
  );

  const getById = (id: string): OrgPlan | null => {
    const row = byIdStmt.get(id) as Row | undefined;
    return row ? rowToPlan(row) : null;
  };

  return {
    insert(input) {
      const id = `orgplan_${randomUUID()}`;
      insertStmt.run({
        id,
        companyId: input.companyId,
        proposedByAgentId: input.proposedByAgentId,
        summary: input.summary,
        rolesJson: JSON.stringify(input.roles),
        agentsJson: JSON.stringify(input.agents),
        proposedAt: Date.now(),
      });
      return getById(id)!;
    },
    getById,
    getCurrentForCompany(companyId) {
      const row = currentStmt.get(companyId) as Row | undefined;
      return row ? rowToPlan(row) : null;
    },
    markApproved(id) {
      approveStmt.run(Date.now(), id);
    },
    markRejected(id, userFeedback) {
      rejectStmt.run(Date.now(), userFeedback, id);
    },
    markSuperseded(id) {
      supersedeStmt.run(Date.now(), id);
    },
  };
};
