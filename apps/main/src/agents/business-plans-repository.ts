import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  BusinessPlan,
  BusinessPlanStatus,
  BusinessPlanIdentity,
  BusinessPlanMarketing,
  ChargeModel,
  DroppedIdea,
} from "@prospero/shared";

export type BusinessPlanInsert = {
  companyId: string;
  proposedByAgentId: string;
  concept: string;
  monetization: string[];
  pricing?: ChargeModel;
  marketing: BusinessPlanMarketing;
  identity: BusinessPlanIdentity;
  dropped: DroppedIdea[];
};

export type BusinessPlansRepository = {
  insert(input: BusinessPlanInsert): BusinessPlan;
  getById(id: string): BusinessPlan | null;
  // The current 'proposed' plan for a company, or null. 'critiquing' is excluded.
  getCurrentForCompany(companyId: string): BusinessPlan | null;
  // The most recently approved plan for a company, or null. Used by the
  // setup_monetization tool to enact the owner-approved charge model.
  getLatestApprovedForCompany(companyId: string): BusinessPlan | null;
  markApproved(id: string): void;
  markRejected(id: string, userFeedback: string | null): void;
  markProposed(id: string): void;
  supersedeActiveForCompany(companyId: string): void;
};

type Row = {
  id: string;
  company_id: string;
  proposed_by_agent_id: string;
  concept: string;
  monetization_json: string;
  pricing_json: string | null;
  marketing_json: string;
  identity_json: string;
  dropped_json: string;
  status: string;
  user_feedback: string | null;
  proposed_at: number;
  decided_at: number | null;
};

const rowToPlan = (r: Row): BusinessPlan => ({
  id: r.id,
  companyId: r.company_id,
  proposedByAgentId: r.proposed_by_agent_id,
  concept: r.concept,
  monetization: JSON.parse(r.monetization_json) as string[],
  pricing: r.pricing_json !== null ? (JSON.parse(r.pricing_json) as ChargeModel) : null,
  marketing: JSON.parse(r.marketing_json) as BusinessPlanMarketing,
  identity: JSON.parse(r.identity_json) as BusinessPlanIdentity,
  dropped: JSON.parse(r.dropped_json) as DroppedIdea[],
  status: r.status as BusinessPlanStatus,
  userFeedback: r.user_feedback,
  proposedAt: r.proposed_at,
  decidedAt: r.decided_at,
});

export const createBusinessPlansRepository = (db: Database.Database): BusinessPlansRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO business_plans
      (id, company_id, proposed_by_agent_id, concept, monetization_json,
       pricing_json, marketing_json, identity_json, dropped_json, status,
       user_feedback, proposed_at, decided_at)
    VALUES
      (@id, @companyId, @proposedByAgentId, @concept, @monetizationJson,
       @pricingJson, @marketingJson, @identityJson, @droppedJson, 'critiquing',
       NULL, @proposedAt, NULL)
  `);
  const byIdStmt = db.prepare("SELECT * FROM business_plans WHERE id = ?");
  const currentStmt = db.prepare(
    "SELECT * FROM business_plans WHERE company_id = ? AND status = 'proposed' ORDER BY proposed_at DESC LIMIT 1",
  );
  const latestApprovedStmt = db.prepare(
    "SELECT * FROM business_plans WHERE company_id = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1",
  );
  const approveStmt = db.prepare(
    "UPDATE business_plans SET status = 'approved', decided_at = ? WHERE id = ?",
  );
  const rejectStmt = db.prepare(
    "UPDATE business_plans SET status = 'rejected', decided_at = ?, user_feedback = ? WHERE id = ?",
  );
  const markProposedStmt = db.prepare(
    "UPDATE business_plans SET status = 'proposed' WHERE id = ? AND status = 'critiquing'",
  );
  const supersedeActiveStmt = db.prepare(
    "UPDATE business_plans SET status = 'superseded', decided_at = ? WHERE company_id = ? AND status IN ('proposed','critiquing')",
  );

  const getById = (id: string): BusinessPlan | null => {
    const row = byIdStmt.get(id) as Row | undefined;
    return row ? rowToPlan(row) : null;
  };

  return {
    insert(input) {
      const id = `bizplan_${randomUUID()}`;
      insertStmt.run({
        id,
        companyId: input.companyId,
        proposedByAgentId: input.proposedByAgentId,
        concept: input.concept,
        monetizationJson: JSON.stringify(input.monetization),
        pricingJson: input.pricing !== undefined ? JSON.stringify(input.pricing) : null,
        marketingJson: JSON.stringify(input.marketing),
        identityJson: JSON.stringify(input.identity),
        droppedJson: JSON.stringify(input.dropped),
        proposedAt: Date.now(),
      });
      return getById(id)!;
    },
    getById,
    getCurrentForCompany(companyId) {
      const row = currentStmt.get(companyId) as Row | undefined;
      return row ? rowToPlan(row) : null;
    },
    getLatestApprovedForCompany(companyId) {
      const row = latestApprovedStmt.get(companyId) as Row | undefined;
      return row ? rowToPlan(row) : null;
    },
    markApproved(id) {
      approveStmt.run(Date.now(), id);
    },
    markRejected(id, userFeedback) {
      rejectStmt.run(Date.now(), userFeedback, id);
    },
    markProposed(id) {
      markProposedStmt.run(id);
    },
    supersedeActiveForCompany(companyId) {
      supersedeActiveStmt.run(Date.now(), companyId);
    },
  };
};
