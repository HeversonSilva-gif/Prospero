// The verification engine (spec §6.2). Reads a goal's criteria, runs each
// deterministic check (persisting its result), reads each judgment criterion's
// current status, and returns a VerificationReport. A goal with no criteria
// verifies trivially — this guarantees non-regression for pre-M13 goals.

import type { CriterionResult, VerificationReport } from "@prospero/shared";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { checkDeterministic } from "./checks.js";
import type { VerifyContext } from "./checks.js";

export const runGoalVerification = async (
  goalId: string,
  ctx: VerifyContext,
): Promise<VerificationReport> => {
  const criteriaRepo = createGoalCriteriaRepository(ctx.db);
  const criteria = criteriaRepo.listByGoal(goalId);

  if (criteria.length === 0) {
    return { goalId, allPassed: true, results: [], pendingJudgment: [] };
  }

  const results: CriterionResult[] = [];
  for (const c of criteria) {
    if (c.kind === "judgment") {
      // Judgment is not "run" — its status is whatever a reviewer/user set.
      results.push({
        criterionId: c.id,
        status: c.status,
        detail: `judgment: ${c.status}`,
        resultJson: null,
      });
      continue;
    }
    const result = await checkDeterministic(c, ctx);
    criteriaRepo.applyResult(result);
    results.push(result);
  }

  const pendingJudgment = results.filter((r) => r.status === "pending").map((r) => r.criterionId);
  const allPassed = results.every((r) => r.status === "passed" || r.status === "waived");
  return { goalId, allPassed, results, pendingJudgment };
};
