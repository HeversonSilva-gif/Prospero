import { describe, it, expect } from "vitest";
import { GoalPlanPayloadSchema } from "./goalPlan.js";

const oneIssue = {
  index: 0,
  title: "Build the thing",
  description: "",
  priority: "medium" as const,
  assigneeIndex: "CEO" as const,
  estimatedTokens: 100,
  dependsOnIndexes: [] as number[],
  rationale: "core",
};

const basePlan = {
  summary: "A plan that is at least twenty characters long.",
  agentsToHire: [] as unknown[],
  issuesToCreate: [oneIssue],
  risks: [] as unknown[],
};

describe("GoalPlanPayloadSchema — zero-issue plans (I-zero, audit 2026-06-03)", () => {
  it("rejects a plan with no issues (it would trap the goal in in_progress forever)", () => {
    const result = GoalPlanPayloadSchema.safeParse({ ...basePlan, issuesToCreate: [] });
    expect(result.success).toBe(false);
  });

  it("accepts a plan with at least one issue", () => {
    const result = GoalPlanPayloadSchema.safeParse(basePlan);
    expect(result.success).toBe(true);
  });
});
