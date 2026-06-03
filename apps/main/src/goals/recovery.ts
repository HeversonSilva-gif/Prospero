import type Database from "better-sqlite3";
import { isCeoAgent } from "@prospero/shared";
import { createGoalsRepository } from "./repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { runVerification, type RunVerificationDeps } from "../verification/index.js";
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
    const ceo = agentsRepo.listByCompany(row.company_id).find(isCeoAgent);
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

// C2 (audit 2026-06-03): safety-net for goals stranded `in_progress` with every
// issue terminal — left over from before the loop-closing fix, or if the
// best-effort issue.updated event was ever dropped. Mirrors maybeStartVerification's
// goal gate but scans ALL in_progress goals. Idempotent: a goal that advances
// past `in_progress` is excluded by the status query. Run at boot + periodically.
// Returns the goal ids it moved to `verifying`.
export const scanStrandedInProgress = (
  db: Database.Database,
  deps: RunVerificationDeps,
): string[] => {
  const goalsRepo = createGoalsRepository(db);
  const issuesRepo = createIssuesRepository(db);
  const rows = db.prepare("SELECT id FROM goals WHERE status = 'in_progress'").all() as {
    id: string;
  }[];
  const triggered: string[] = [];
  for (const { id } of rows) {
    const issues = issuesRepo.listByGoal(id);
    const allTerminal =
      issues.length > 0 && issues.every((i) => i.status === "done" || i.status === "cancelled");
    if (!allTerminal) continue;
    goalsRepo.updateStatus(id, "verifying");
    void runVerification(db, id, deps).catch((err: unknown) =>
      console.warn(`[recovery] stranded-goal verification failed for ${id}: ${String(err)}`),
    );
    triggered.push(id);
  }
  return triggered;
};
