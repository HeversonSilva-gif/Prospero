import { describe, it, expect } from "vitest";
import type { CriterionResult, VerificationReport } from "./verification.js";

describe("verification types", () => {
  it("CriterionResult and VerificationReport are usable", () => {
    const result: CriterionResult = {
      criterionId: "crit_1",
      status: "passed",
      detail: "exit 0",
      resultJson: { exitCode: 0 },
    };
    const report: VerificationReport = {
      goalId: "goal_1",
      allPassed: true,
      results: [result],
      pendingJudgment: [],
    };
    expect(report.results[0]!.status).toBe("passed");
    expect(report.allPassed).toBe(true);
  });
});
