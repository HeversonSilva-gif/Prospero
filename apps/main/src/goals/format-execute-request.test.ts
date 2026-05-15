import { describe, it, expect } from "vitest";
import { formatGoalExecuteRequest } from "./format-execute-request.js";
import type { Goal, GoalPlan } from "@prospero/shared";

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g_1",
  companyId: "co",
  title: "Ship v1",
  description: null,
  level: "task",
  status: "approved",
  parentGoalId: null,
  ownerAgentId: null,
  budgetMaxTokens: null,
  deadline: null,
  successCriteria: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const plan = (over: Partial<GoalPlan> = {}): GoalPlan => ({
  id: "p_1",
  goalId: "g_1",
  version: 1,
  proposedByAgentId: "a_ceo",
  summary: "Plan summary text here.",
  agentsToHire: [
    {
      index: 0,
      name: "Sarah",
      roleTemplateId: "role-engineer",
      model: "sonnet-4",
      personaSummary: "lead",
      capabilities: ["shell"],
      reportsToIndex: "CEO",
      rationale: "x",
    },
  ],
  issuesToCreate: [
    {
      index: 0,
      title: "Skeleton",
      description: "",
      priority: "medium",
      assigneeIndex: 0,
      estimatedTokens: 5000,
      dependsOnIndexes: [],
      rationale: "x",
    },
  ],
  estimatedTotalTokens: null,
  estimatedDurationDays: null,
  estimatedCostCents: null,
  risks: [],
  status: "proposed",
  userFeedback: null,
  proposedAt: 0,
  decidedAt: null,
  decidedBy: null,
  ...over,
});

describe("formatGoalExecuteRequest", () => {
  it("includes goal id, plan id, version, summary, and tool roster", () => {
    const out = formatGoalExecuteRequest(goal(), plan());
    expect(out).toContain("[GOAL_EXECUTE_REQUEST]");
    expect(out).toContain("goalId=g_1");
    expect(out).toContain("planId=p_1");
    expect(out).toContain("mode=narrated");
    expect(out).toContain("hire_agent_for_plan");
    expect(out).toContain("create_issue_for_plan");
    expect(out).toContain("comment_on_issue");
    expect(out).toContain("finalize_goal_execution");
    expect(out).toContain("Plan summary text here.");
    expect(out).toContain("Sarah");
    expect(out).toContain("Skeleton");
  });

  it("formats reportsToIndex='CEO' as literal 'CEO'", () => {
    const out = formatGoalExecuteRequest(goal(), plan());
    expect(out).toMatch(/reportsTo:\s*CEO/);
  });

  it("formats numeric reportsToIndex with # prefix", () => {
    const p = plan({
      agentsToHire: [
        {
          index: 0,
          name: "Lead",
          roleTemplateId: "role-eng",
          model: "x",
          personaSummary: "y",
          capabilities: [],
          reportsToIndex: "CEO",
          rationale: "z",
        },
        {
          index: 1,
          name: "Sub",
          roleTemplateId: "role-eng",
          model: "x",
          personaSummary: "y",
          capabilities: [],
          reportsToIndex: 0,
          rationale: "z",
        },
      ],
    });
    const out = formatGoalExecuteRequest(goal(), p);
    expect(out).toMatch(/reportsTo:\s*#0/);
  });
});
