// M13 PR-B — verification engine result types. Pure types, no zod.

import type { CriterionStatus } from "./isa.js";

// The outcome of checking one ISC.
export interface CriterionResult {
  criterionId: string;
  status: CriterionStatus;
  // Human-readable one-liner, e.g. "exit 0" or "timeout 600000ms".
  detail: string;
  // Persisted to goal_criteria.last_result_json (stringified).
  resultJson: unknown;
}

// The outcome of verifying a whole goal.
export interface VerificationReport {
  goalId: string;
  allPassed: boolean;
  results: CriterionResult[];
  // ids of judgment ISCs still in 'pending' — the goal stays in `verifying`.
  pendingJudgment: string[];
}
