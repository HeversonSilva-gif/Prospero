import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { GoalPlan, GoalPlanStatus, AgentToHire, IssueToCreate, Risk } from "@prospero/shared";

export type GoalPlanInsert = {
  goalId: string;
  version: number;
  proposedByAgentId: string;
  summary: string;
  agentsToHire: AgentToHire[];
  issuesToCreate: IssueToCreate[];
  estimatedTotalTokens: number | null;
  estimatedDurationDays: number | null;
  estimatedCostCents: number | null;
  risks: Risk[];
  status?: GoalPlanStatus;
};

export type GoalPlansRepository = {
  insert(input: GoalPlanInsert): GoalPlan;
  getById(id: string): GoalPlan | null;
  getCurrent(goalId: string): GoalPlan | null;
  getHistory(goalId: string): GoalPlan[];
  nextVersion(goalId: string): number;
  markApproved(id: string, opts: { decidedBy: string }): void;
  markRejected(id: string, userFeedback: string | null): void;
  markSuperseded(id: string): void;
  markProposed(id: string): void;
  supersedeActiveForGoal(goalId: string): void;
};

type Row = {
  id: string;
  goal_id: string;
  version: number;
  proposed_by_agent_id: string;
  summary: string;
  agents_to_hire_json: string;
  issues_to_create_json: string;
  estimated_total_tokens: number | null;
  estimated_duration_days: number | null;
  estimated_cost_cents: number | null;
  risks_json: string | null;
  status: string;
  user_feedback: string | null;
  proposed_at: number;
  decided_at: number | null;
  decided_by: string | null;
};

const rowToPlan = (r: Row): GoalPlan => ({
  id: r.id,
  goalId: r.goal_id,
  version: r.version,
  proposedByAgentId: r.proposed_by_agent_id,
  summary: r.summary,
  agentsToHire: JSON.parse(r.agents_to_hire_json) as AgentToHire[],
  issuesToCreate: JSON.parse(r.issues_to_create_json) as IssueToCreate[],
  estimatedTotalTokens: r.estimated_total_tokens,
  estimatedDurationDays: r.estimated_duration_days,
  estimatedCostCents: r.estimated_cost_cents,
  risks: r.risks_json ? (JSON.parse(r.risks_json) as Risk[]) : [],
  status: r.status as GoalPlanStatus,
  userFeedback: r.user_feedback,
  proposedAt: r.proposed_at,
  decidedAt: r.decided_at,
  decidedBy: r.decided_by,
});

export const createGoalPlansRepository = (db: Database.Database): GoalPlansRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO goal_plans (
      id, goal_id, version, proposed_by_agent_id, summary,
      agents_to_hire_json, issues_to_create_json,
      estimated_total_tokens, estimated_duration_days, estimated_cost_cents,
      risks_json, status, user_feedback, proposed_at, decided_at, decided_by
    ) VALUES (
      @id, @goalId, @version, @proposedByAgentId, @summary,
      @agentsToHireJson, @issuesToCreateJson,
      @estimatedTotalTokens, @estimatedDurationDays, @estimatedCostCents,
      @risksJson, @status, NULL, @proposedAt, NULL, NULL
    )
  `);

  const getByIdStmt = db.prepare(`SELECT * FROM goal_plans WHERE id = ?`);

  const getCurrentStmt = db.prepare(`
    SELECT * FROM goal_plans
    WHERE goal_id = ? AND status IN ('proposed', 'approved')
    ORDER BY version DESC LIMIT 1
  `);

  const getHistoryStmt = db.prepare(`
    SELECT * FROM goal_plans
    WHERE goal_id = ? AND status IN ('superseded', 'rejected')
    ORDER BY version DESC
  `);

  const maxVersionStmt = db.prepare(`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM goal_plans WHERE goal_id = ?
  `);

  const markApprovedStmt = db.prepare(`
    UPDATE goal_plans SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?
  `);

  const markRejectedStmt = db.prepare(`
    UPDATE goal_plans SET status = 'rejected', decided_at = ?, decided_by = 'user',
    user_feedback = ? WHERE id = ?
  `);

  const markSupersededStmt = db.prepare(`
    UPDATE goal_plans SET status = 'superseded', decided_at = ?, decided_by = 'user' WHERE id = ?
  `);

  const markProposedStmt = db.prepare(
    `UPDATE goal_plans SET status = 'proposed' WHERE id = ? AND status = 'critiquing'`,
  );

  const supersedeActiveStmt = db.prepare(
    `UPDATE goal_plans SET status = 'superseded', decided_at = ?, decided_by = 'system'
     WHERE goal_id = ? AND status IN ('proposed','critiquing')`,
  );

  const insert = (input: GoalPlanInsert): GoalPlan => {
    const id = `plan_${randomUUID()}`;
    const proposedAt = Date.now();
    insertStmt.run({
      id,
      goalId: input.goalId,
      version: input.version,
      proposedByAgentId: input.proposedByAgentId,
      summary: input.summary,
      agentsToHireJson: JSON.stringify(input.agentsToHire),
      issuesToCreateJson: JSON.stringify(input.issuesToCreate),
      estimatedTotalTokens: input.estimatedTotalTokens,
      estimatedDurationDays: input.estimatedDurationDays,
      estimatedCostCents: input.estimatedCostCents,
      risksJson: JSON.stringify(input.risks),
      status: input.status ?? "proposed",
      proposedAt,
    });
    return rowToPlan(getByIdStmt.get(id) as Row);
  };

  const getById = (id: string): GoalPlan | null => {
    const row = getByIdStmt.get(id) as Row | undefined;
    return row ? rowToPlan(row) : null;
  };

  const getCurrent = (goalId: string): GoalPlan | null => {
    const row = getCurrentStmt.get(goalId) as Row | undefined;
    return row ? rowToPlan(row) : null;
  };

  const getHistory = (goalId: string): GoalPlan[] => {
    const rows = getHistoryStmt.all(goalId) as Row[];
    return rows.map(rowToPlan);
  };

  const nextVersion = (goalId: string): number => {
    const { max_version } = maxVersionStmt.get(goalId) as { max_version: number };
    return max_version + 1;
  };

  const markApproved = (id: string, opts: { decidedBy: string }): void => {
    markApprovedStmt.run(Date.now(), opts.decidedBy, id);
  };

  const markRejected = (id: string, userFeedback: string | null): void => {
    markRejectedStmt.run(Date.now(), userFeedback, id);
  };

  const markSuperseded = (id: string): void => {
    markSupersededStmt.run(Date.now(), id);
  };

  const markProposed = (id: string): void => {
    markProposedStmt.run(id);
  };

  const supersedeActiveForGoal = (goalId: string): void => {
    supersedeActiveStmt.run(Date.now(), goalId);
  };

  return {
    insert,
    getById,
    getCurrent,
    getHistory,
    nextVersion,
    markApproved,
    markRejected,
    markSuperseded,
    markProposed,
    supersedeActiveForGoal,
  };
};
