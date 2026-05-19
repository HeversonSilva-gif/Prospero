import { describe, it, expect } from "vitest";
import type { Goal } from "@prospero/shared";
import { formatGoalPlanRequest } from "./format-request.js";

const sample: Goal = {
  id: "goal_abc",
  companyId: "co_1",
  title: "Build login flow",
  description: "OAuth + session mgmt",
  level: "task",
  status: "planning",
  parentGoalId: null,
  ownerAgentId: null,
  budgetMaxTokens: 100_000,
  deadline: 1_700_000_000_000,
  successCriteria: "Users can sign in",
  isaPath: null,
  createdAt: 0,
  updatedAt: 0,
};

describe("formatGoalPlanRequest", () => {
  it("emits the [GOAL_PLAN_REQUEST] prefix and all fields", () => {
    const out = formatGoalPlanRequest(sample);
    expect(out).toMatch(/^\[GOAL_PLAN_REQUEST\]/);
    expect(out).toContain("goal_id=goal_abc");
    expect(out).toContain("title=Build login flow");
    expect(out).toContain("description=OAuth + session mgmt");
    expect(out).toContain("level=task");
    expect(out).toContain("budget_max_tokens=100000");
    expect(out).toContain("deadline=1700000000000");
    expect(out).toContain("success_criteria=Users can sign in");
  });

  it("omits null/undefined fields gracefully", () => {
    const out = formatGoalPlanRequest({ ...sample, budgetMaxTokens: null, deadline: null });
    expect(out).not.toContain("budget_max_tokens");
    expect(out).not.toContain("deadline");
  });

  it("appends [FEEDBACK] suffix when feedback provided", () => {
    const out = formatGoalPlanRequest(sample, "Reduce scope to OAuth only");
    expect(out).toContain("[FEEDBACK] Reduce scope to OAuth only");
  });

  it("does not append [FEEDBACK] when undefined", () => {
    const out = formatGoalPlanRequest(sample);
    expect(out).not.toContain("[FEEDBACK]");
  });
});
