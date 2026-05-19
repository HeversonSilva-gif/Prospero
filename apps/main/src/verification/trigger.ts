// Bridges the issue lifecycle to the verification engine (spec §6.1): when the
// LAST issue of an in_progress goal reaches done/cancelled, the goal moves to
// `verifying` and verification runs (fire-and-forget).
//
// NOTE: The shared `Issue` type does not carry `goalId`, so the goal link is
// resolved via the issues repository's `getGoalId`.

import type Database from "better-sqlite3";
import type { Issue } from "@prospero/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { runVerification, type RunVerificationDeps } from "./index.js";

export const maybeStartVerification = (
  db: Database.Database,
  issue: Issue,
  deps: RunVerificationDeps,
): void => {
  if (issue.status !== "done" && issue.status !== "cancelled") return;

  const issuesRepo = createIssuesRepository(db);
  const goalId = issuesRepo.getGoalId(issue.id);
  if (goalId === null) return;

  const goalsRepo = createGoalsRepository(db);
  const goal = goalsRepo.getById(goalId);
  if (goal === null || goal.status !== "in_progress") return;

  const issues = issuesRepo.listByGoal(goal.id);
  const allTerminal =
    issues.length > 0 && issues.every((i) => i.status === "done" || i.status === "cancelled");
  if (!allTerminal) return;

  goalsRepo.updateStatus(goal.id, "verifying");
  void runVerification(db, goal.id, deps).catch((err: unknown) => {
    console.warn(`[verification] run failed for goal ${goal.id}: ${String(err)}`);
  });
};
