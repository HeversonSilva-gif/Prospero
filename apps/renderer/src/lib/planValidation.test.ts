import { describe, expect, it } from "vitest";
import type { GoalPlan } from "@dashboard-agent/shared";
import {
  validatePlanSelection,
  computeFilteredEstimates,
  type PlanFilter,
} from "./planValidation.js";

const planFixture = (): GoalPlan => ({
  id: "p_1",
  goalId: "g_1",
  version: 1,
  proposedByAgentId: "a_ceo",
  summary: "x",
  status: "proposed",
  userFeedback: null,
  proposedAt: 0,
  decidedAt: null,
  decidedBy: null,
  estimatedTotalTokens: 100_000,
  estimatedDurationDays: 3,
  estimatedCostCents: 200,
  risks: [],
  agentsToHire: [
    {
      index: 0,
      name: "Lead",
      roleTemplateId: "role-eng",
      model: "sonnet-4",
      personaSummary: "lead",
      skills: ["shell"],
      reportsToIndex: "CEO",
      rationale: "x",
    },
    {
      index: 1,
      name: "Sub",
      roleTemplateId: "role-eng",
      model: "sonnet-4",
      personaSummary: "sub",
      skills: ["shell"],
      reportsToIndex: 0,
      rationale: "x",
    },
  ],
  issuesToCreate: [
    {
      index: 0,
      title: "First",
      description: "",
      priority: "medium",
      assigneeIndex: 0,
      estimatedTokens: 30_000,
      dependsOnIndexes: [],
      rationale: "x",
    },
    {
      index: 1,
      title: "Second",
      description: "",
      priority: "medium",
      assigneeIndex: 1,
      estimatedTokens: 70_000,
      dependsOnIndexes: [0],
      rationale: "x",
    },
  ],
});

const allIncluded = (plan: GoalPlan): PlanFilter => ({
  includedAgentIndexes: new Set(plan.agentsToHire.map((a) => a.index)),
  includedIssueIndexes: new Set(plan.issuesToCreate.map((i) => i.index)),
});

describe("validatePlanSelection", () => {
  it("returns no errors when everything is included", () => {
    const plan = planFixture();
    expect(validatePlanSelection(plan, allIncluded(plan))).toEqual([]);
  });

  it("flags issue with excluded dependency", () => {
    const plan = planFixture();
    const filter = allIncluded(plan);
    filter.includedIssueIndexes.delete(0);
    const errors = validatePlanSelection(plan, filter);
    expect(errors).toContainEqual({ kind: "issue-dep-excluded", issueIndex: 1, depIndex: 0 });
  });

  it("flags issue whose assignee is excluded", () => {
    const plan = planFixture();
    const filter = allIncluded(plan);
    filter.includedAgentIndexes.delete(1);
    // issue 1 also depends on 0 (still included) but its assignee #1 is now excluded
    const errors = validatePlanSelection(plan, filter);
    expect(
      errors.some(
        (e) => e.kind === "issue-assignee-excluded" && e.issueIndex === 1 && e.agentIndex === 1,
      ),
    ).toBe(true);
  });

  it("flags agent whose reports-to is excluded", () => {
    const plan = planFixture();
    const filter = allIncluded(plan);
    filter.includedAgentIndexes.delete(0);
    // agent #1 reports_to=0 (now excluded) — but #1 itself can still be included
    const errors = validatePlanSelection(plan, filter);
    expect(
      errors.some(
        (e) =>
          e.kind === "agent-reports-to-excluded" && e.agentIndex === 1 && e.reportsToIndex === 0,
      ),
    ).toBe(true);
  });

  it("treats 'CEO' reports-to and assignee as always valid", () => {
    const plan: GoalPlan = {
      ...planFixture(),
      agentsToHire: [
        {
          index: 0,
          name: "Sole",
          roleTemplateId: "role-eng",
          model: "sonnet-4",
          personaSummary: "x",
          skills: [],
          reportsToIndex: "CEO",
          rationale: "x",
        },
      ],
      issuesToCreate: [
        {
          index: 0,
          title: "ceo task",
          description: "",
          priority: "low",
          assigneeIndex: "CEO",
          estimatedTokens: 1_000,
          dependsOnIndexes: [],
          rationale: "x",
        },
      ],
    };
    expect(validatePlanSelection(plan, allIncluded(plan))).toEqual([]);
  });
});

describe("computeFilteredEstimates", () => {
  it("returns plan-level estimates when all included", () => {
    const plan = planFixture();
    const e = computeFilteredEstimates(plan, allIncluded(plan));
    expect(e.totalTokens).toBe(100_000);
    expect(e.costCents).toBe(200);
    expect(e.durationDays).toBe(3);
  });

  it("scales tokens and cost proportionally when subset excluded", () => {
    const plan = planFixture();
    const filter = allIncluded(plan);
    filter.includedIssueIndexes.delete(1); // 70k of 100k excluded
    const e = computeFilteredEstimates(plan, filter);
    // 30k / 100k = 0.3 → 30k tokens, 60 cents
    expect(e.totalTokens).toBe(30_000);
    expect(e.costCents).toBe(60);
  });

  it("falls back to sum of included issue tokens when plan-level missing", () => {
    const plan: GoalPlan = {
      ...planFixture(),
      estimatedTotalTokens: null,
      estimatedCostCents: null,
    };
    const filter = allIncluded(plan);
    filter.includedIssueIndexes.delete(0);
    const e = computeFilteredEstimates(plan, filter);
    expect(e.totalTokens).toBe(70_000);
    expect(e.costCents).toBeNull();
  });

  it("returns zero tokens when every issue is excluded", () => {
    const plan = planFixture();
    const filter: PlanFilter = {
      includedAgentIndexes: new Set(),
      includedIssueIndexes: new Set(),
    };
    const e = computeFilteredEstimates(plan, filter);
    expect(e.totalTokens).toBe(0);
    expect(e.costCents).toBe(0);
  });
});
