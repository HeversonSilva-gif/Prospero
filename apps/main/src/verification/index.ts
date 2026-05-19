// The verification gate (spec §6.4) + production wiring.
// applyVerificationReport transitions a `verifying` goal: all-pass -> achieved;
// any fail -> in_progress + verification_failed inbox; pending judgment ->
// stays verifying + verification_review inbox. runVerification = engine + gate.
// recoverStuckVerifications re-runs goals left in `verifying` after a restart.

import type Database from "better-sqlite3";
import type { Goal, VerificationReport } from "@prospero/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { runGoalVerification } from "./engine.js";
import { runSandboxedCommand } from "./sandbox.js";
import type { RunSandboxedCommandInput, SandboxedCommandResult } from "./sandbox.js";
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
): void => {
  const goalsRepo = createGoalsRepository(db);
  const goal = goalsRepo.getById(report.goalId);
  if (goal === null || goal.status !== "verifying") return;

  const failed = report.results.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    goalsRepo.updateStatus(goal.id, "in_progress");
    createInboxRepository(db).create({
      companyId: goal.companyId,
      kind: "verification_failed",
      title: `Verification failed: ${goal.title}`,
      preview: failed[0]!.detail.slice(0, 200),
      requiresAction: true,
      payloadJson: JSON.stringify({
        goalId: goal.id,
        failedCriteria: failed.map((f) => f.criterionId),
      }),
    });
    return;
  }

  if (report.pendingJudgment.length > 0) {
    createInboxRepository(db).create({
      companyId: goal.companyId,
      kind: "verification_review",
      title: `Review needed: ${goal.title}`,
      preview: `${report.pendingJudgment.length} criteria need your judgment`,
      requiresAction: true,
      payloadJson: JSON.stringify({ goalId: goal.id, pending: report.pendingJudgment }),
    });
    return;
  }

  goalsRepo.updateStatus(goal.id, "achieved");
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

// Boot recovery: re-run any goal left in `verifying` by a crash/restart.
export const recoverStuckVerifications = (
  db: Database.Database,
  deps: RunVerificationDeps,
): void => {
  const rows = db.prepare("SELECT id FROM goals WHERE status = 'verifying'").all() as {
    id: string;
  }[];
  for (const row of rows) {
    void runVerification(db, row.id, deps).catch(() => {
      /* a stuck goal that fails to re-verify stays verifying — surfaced in UI */
    });
  }
};
