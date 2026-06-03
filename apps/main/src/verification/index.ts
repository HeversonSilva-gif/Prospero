// The verification gate (spec §6.4) + production wiring.
// applyVerificationReport transitions a `verifying` goal: all-pass -> achieved;
// any fail -> in_progress + verification_failed inbox (conditional — see
// RETRY_CAP); pending judgment -> stays verifying + verification_review inbox.
// runVerification = engine + gate.
// recoverStuckVerifications re-runs goals left in `verifying` after a restart.

// Hermes rec #3: a goal's verification may auto-retry through the CEO this many
// times before the human is asked. `goal_criteria.attempts` bounds it.
export const RETRY_CAP = 2;

import type Database from "better-sqlite3";
import type { CriterionResult, Goal, VerificationReport } from "@prospero/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { recomputeAgentTrust } from "../trust/engine.js";
import { runGoalVerification } from "./engine.js";
import { runSandboxedCommand } from "./sandbox.js";
import type { RunSandboxedCommandInput, SandboxedCommandResult } from "./sandbox.js";
import { checkDeterministic } from "./checks.js";
import type { VerifyContext } from "./checks.js";

export interface RunVerificationDeps {
  // The sandbox cwd for a goal's command checks (goal owner's sandbox).
  sandboxRootFor: (goal: Goal) => string;
  // Invokes a Prospero MCP tool by name for a metric check.
  callMetricTool: (tool: string, params: Record<string, unknown>) => Promise<unknown>;
  // Injected for tests; defaults to the real sandboxed runner.
  runCommand?: (input: RunSandboxedCommandInput) => Promise<SandboxedCommandResult>;
  // Optional UI notification after the gate runs (inbox/goal changed).
  notify?: (companyId: string) => void;
}

// Applies a verification report to a goal that is currently `verifying`.
// A no-op if the goal moved on (defensive against double runs).
export const applyVerificationReport = (
  db: Database.Database,
  report: VerificationReport,
  opts: { fileReviewCard?: boolean } = {},
): void => {
  const goalsRepo = createGoalsRepository(db);
  const goal = goalsRepo.getById(report.goalId);
  if (goal === null || goal.status !== "verifying") return;

  const failed = report.results.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    goalsRepo.updateStatus(goal.id, "in_progress");
    const failedCriteria = failed.map((f) => f.criterionId);

    const criteria = createGoalCriteriaRepository(db).listByGoal(goal.id);
    const failedSet = new Set(failedCriteria);
    const retryable = criteria.some(
      (c) => failedSet.has(c.id) && c.kind === "deterministic" && c.attempts <= RETRY_CAP,
    );
    if (!retryable) {
      createInboxRepository(db).create({
        companyId: goal.companyId,
        kind: "verification_failed",
        title: `Verification failed: ${goal.title}`,
        preview:
          failed.length > 1
            ? `${failed[0]!.detail.slice(0, 150)} (+${failed.length - 1} more)`
            : failed[0]!.detail.slice(0, 200),
        requiresAction: true,
        payloadJson: JSON.stringify({ goalId: goal.id, failedCriteria }),
      });
    }

    tryGetRecorder()?.recordActivity({
      companyId: goal.companyId,
      actor: { kind: "system" },
      action: "verification.failed",
      entityKind: "goal",
      entityId: goal.id,
      agentId: goal.ownerAgentId ?? null,
      payload: { goalId: goal.id, failedCriteria },
    });
    recomputeTrustForGoalOwner(db, goal.ownerAgentId);
    return;
  }

  if (report.pendingJudgment.length > 0) {
    if (opts.fileReviewCard !== false) {
      createInboxRepository(db).create({
        companyId: goal.companyId,
        kind: "verification_review",
        title: `Review needed: ${goal.title}`,
        preview: `${report.pendingJudgment.length} criteria need your judgment`,
        requiresAction: true,
        payloadJson: JSON.stringify({ goalId: goal.id, pending: report.pendingJudgment }),
      });
    }
    return;
  }

  goalsRepo.updateStatus(goal.id, "achieved");
  // Record the success transition so the derivation dispatcher fires the
  // "what worked" retrospective (it keys on goal.status_changed → achieved).
  // The failure path above records its own activity; without this mirror the
  // success-learning loop was silently dead — verification is the only path to
  // `achieved`, so no goal ever produced a success lesson. agentId must be the
  // owner (the dispatcher's null guard drops owner-less rows). Audit
  // 2026-06-03 Facet 5 C1.
  tryGetRecorder()?.recordActivity({
    companyId: goal.companyId,
    actor: { kind: "system" },
    action: "goal.status_changed",
    entityKind: "goal",
    entityId: goal.id,
    agentId: goal.ownerAgentId ?? null,
    payload: { from: "verifying", to: "achieved" },
  });
  recomputeTrustForGoalOwner(db, goal.ownerAgentId);
};

// M14 PR-A — recompute the goal owner's trust ladder after a verification
// outcome. Failure path above and the success path both call this. The
// engine itself is idempotent.
const recomputeTrustForGoalOwner = (db: Database.Database, ownerAgentId: string | null): void => {
  if (ownerAgentId === null) return;
  try {
    recomputeAgentTrust(db, ownerAgentId);
  } catch (err) {
    console.warn("[verification] recomputeAgentTrust failed", err);
  }
};

// Re-evaluates a `verifying` goal from the criteria's already-persisted
// statuses (no checks are re-run) and applies the gate. Used after a user
// resolves a judgment criterion. Does not re-file the review inbox card.
// `notify` mirrors RunVerificationDeps.notify (M13 PR-F): when this path
// closes the goal (e.g. criterion_judge), pings the renderer to refresh.
export const reevaluateGoalFromState = (
  db: Database.Database,
  goalId: string,
  opts: { notify?: (companyId: string) => void } = {},
): void => {
  const goal = createGoalsRepository(db).getById(goalId);
  if (goal === null || goal.status !== "verifying") return;
  const criteria = createGoalCriteriaRepository(db).listByGoal(goalId);
  const results: CriterionResult[] = criteria.map((c) => ({
    criterionId: c.id,
    status: c.status,
    detail: `${c.kind}: ${c.status}`,
    resultJson: null,
  }));
  const pendingJudgment = results.filter((r) => r.status === "pending").map((r) => r.criterionId);
  const allPassed = results.every((r) => r.status === "passed" || r.status === "waived");
  applyVerificationReport(
    db,
    { goalId, allPassed, results, pendingJudgment },
    { fileReviewCard: false },
  );
  opts.notify?.(goal.companyId);
};

// Runs the engine for one goal and applies the gate. Fire-and-forget safe.
export const runVerification = async (
  db: Database.Database,
  goalId: string,
  deps: RunVerificationDeps,
): Promise<VerificationReport> => {
  const goal = createGoalsRepository(db).getById(goalId);
  if (goal === null) throw new Error(`goal not found: ${goalId}`);
  const ctx: VerifyContext = {
    db,
    sandboxRoot: deps.sandboxRootFor(goal),
    runCommand: deps.runCommand ?? runSandboxedCommand,
    callMetricTool: deps.callMetricTool,
  };
  const report = await runGoalVerification(goalId, ctx);
  applyVerificationReport(db, report);
  deps.notify?.(goal.companyId);
  return report;
};

// Runs the deterministic check for ONE criterion and persists the result.
// The single-criterion analog of runVerification — it does NOT run the goal
// gate (the agent calls this to self-check an ISC while still working an
// issue; the goal is not yet `verifying`). Throws for an unknown criterion
// or a judgment criterion (judgment is resolved by criterion_judge, not here).
export const checkOneCriterion = async (
  db: Database.Database,
  criterionId: string,
  deps: RunVerificationDeps,
): Promise<CriterionResult> => {
  const criteriaRepo = createGoalCriteriaRepository(db);
  const criterion = criteriaRepo.getById(criterionId);
  if (criterion === null) throw new Error(`criterion not found: ${criterionId}`);
  if (criterion.kind !== "deterministic") {
    throw new Error(`criterion ${criterionId} is not a deterministic criterion`);
  }
  const goal = createGoalsRepository(db).getById(criterion.goalId);
  if (goal === null) throw new Error(`goal not found: ${criterion.goalId}`);
  const ctx: VerifyContext = {
    db,
    sandboxRoot: deps.sandboxRootFor(goal),
    runCommand: deps.runCommand ?? runSandboxedCommand,
    callMetricTool: deps.callMetricTool,
  };
  const result = await checkDeterministic(criterion, ctx);
  criteriaRepo.applyResult(result);
  return result;
};

// Boot recovery: re-run any goal left in `verifying` by a crash/restart.
export const recoverStuckVerifications = (
  db: Database.Database,
  deps: RunVerificationDeps,
): void => {
  const rows = db.prepare("SELECT id FROM goals WHERE status = 'verifying'").all() as {
    id: string;
  }[];
  for (const row of rows) {
    void runVerification(db, row.id, deps).catch((err: unknown) => {
      // A stuck goal that fails to re-verify stays `verifying` — visible in the
      // UI; log so the failure is diagnosable.
      console.warn(`[verification] recovery failed for goal ${row.id}: ${String(err)}`);
    });
  }
};
