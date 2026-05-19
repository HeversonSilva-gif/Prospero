// Bridges the issue lifecycle to the verification engine (spec §6.1): when the
// LAST issue of an in_progress goal reaches done/cancelled, the goal moves to
// `verifying` and verification runs (fire-and-forget).
//
// NOTE: The shared `Issue` type does not expose `goalId` — the DB column
// `issues.goal_id` is not projected by rowToIssue in the issues repository.
// The trigger resolves the goal link via a direct DB query.

import type Database from "better-sqlite3";
import type { Issue } from "@prospero/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { runVerification } from "./index.js";
import type { RunVerificationDeps } from "./index.js";

export const maybeStartVerification = (
  db: Database.Database,
  issue: Issue,
  deps: RunVerificationDeps,
): void => {
  if (issue.status !== "done" && issue.status !== "cancelled") return;

  // Resolve the goal_id for this issue via raw SQL (not in the shared Issue type).
  const row = db.prepare("SELECT goal_id FROM issues WHERE id = ?").get(issue.id) as
    | { goal_id: string | null }
    | undefined;
  const goalId = row?.goal_id ?? null;
  if (goalId === null) return;

  const goalsRepo = createGoalsRepository(db);
  const goal = goalsRepo.getById(goalId);
  if (goal === null || goal.status !== "in_progress") return;

  const issues = createIssuesRepository(db).listByGoal(goal.id);
  const allTerminal =
    issues.length > 0 && issues.every((i) => i.status === "done" || i.status === "cancelled");
  if (!allTerminal) return;

  goalsRepo.updateStatus(goal.id, "verifying");
  void runVerification(db, goal.id, deps).catch((err: unknown) => {
    console.warn(`[verification] run failed for goal ${goal.id}: ${String(err)}`);
  });
};
