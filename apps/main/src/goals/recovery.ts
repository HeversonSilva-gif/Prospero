import type Database from "better-sqlite3";
import { createGoalsRepository } from "./repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { formatGoalPlanRequest } from "./format-request.js";

export type RecoveryDeps = {
  deliverSystemMessage: (agentId: string, text: string) => void;
};

export const scanPlanningWithoutPlan = (db: Database.Database, deps: RecoveryDeps): number => {
  const goalsRepo = createGoalsRepository(db);
  const agentsRepo = createAgentsRepository(db);

  const stuck = db
    .prepare(
      `SELECT * FROM goals g
       WHERE g.status = 'planning'
       AND NOT EXISTS (
         SELECT 1 FROM goal_plans p
         WHERE p.goal_id = g.id AND p.status = 'proposed'
       )`,
    )
    .all() as { id: string; company_id: string }[];

  let enqueued = 0;
  for (const row of stuck) {
    const goal = goalsRepo.getById(row.id);
    if (!goal) continue;
    const ceo = agentsRepo
      .listByCompany(row.company_id)
      .find((a) => a.templateId === "ceo" || a.role === "ceo");
    if (!ceo) continue;
    deps.deliverSystemMessage(ceo.id, formatGoalPlanRequest(goal));
    enqueued++;
  }
  return enqueued;
};

// M8.6 — Detect goals stuck mid-narrated-loop (app crash before CEO called
// finalize_goal_execution). Creates a goal_error inbox item per stuck goal so
// the user can resume or rollback. Returns the inbox item ids created.
export const scanStuckNarrated = (db: Database.Database): string[] => {
  const goalsRepo = createGoalsRepository(db);
  const inboxRepo = createInboxRepository(db);
  const stuck = goalsRepo.findStuckNarrated();
  const created: string[] = [];
  for (const goal of stuck) {
    const state = goalsRepo.getExecutionState(goal.id);
    if (state === null) continue;
    const hired = Object.keys(state.agentIndexToId).length;
    const issues = Object.keys(state.issueIndexToId).length;
    const item = inboxRepo.create({
      companyId: goal.companyId,
      kind: "goal_error",
      title: `Plan execution halted for "${goal.title}"`,
      preview: `Narrated loop did not finalize. Last step: ${state.step}. ${hired} agents hired, ${issues} issues created.`,
      payloadJson: JSON.stringify({
        goalId: goal.id,
        planId: state.planId,
        step: "narrated_halted",
        hiredCount: hired,
        issuesCount: issues,
      }),
      requiresAction: true,
    });
    created.push(item.id);
  }
  return created;
};
