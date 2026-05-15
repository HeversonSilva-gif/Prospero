import { describe, it, expect } from "vitest";
import { GoalPlanPayloadSchema } from "../src/schemas/goalPlan.js";

const validAgent = {
  index: 0,
  name: "Sarah",
  roleTemplateId: "swe",
  model: "sonnet-4",
  personaSummary: "Senior backend engineer focused on APIs.",
  capabilities: ["file_ops", "git"],
  reportsToIndex: "CEO" as const,
  rationale: "Needs API expertise for the planned endpoints.",
};

const validIssue = {
  index: 0,
  title: "Set up project skeleton",
  description: "Init npm, tsconfig, vitest.",
  priority: "high" as const,
  assigneeIndex: 0,
  estimatedTokens: 5000,
  dependsOnIndexes: [],
  rationale: "Foundation for all subsequent work.",
};

const validPlan = {
  summary: "Build a small REST API with 1 engineer.",
  agentsToHire: [validAgent],
  issuesToCreate: [validIssue],
  estimatedTotalTokens: 5000,
  estimatedDurationDays: 1,
  estimatedCostCents: 25,
  risks: [
    {
      description: "Scope creep",
      mitigation: "Strict acceptance criteria",
      severity: "low" as const,
    },
  ],
};

describe("GoalPlanPayloadSchema", () => {
  it("accepts a minimal valid plan", () => {
    const result = GoalPlanPayloadSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
  });

  it("rejects when agent indexes are not unique", () => {
    const plan = {
      ...validPlan,
      agentsToHire: [validAgent, { ...validAgent, index: 0, name: "Other" }],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects when agent indexes are non-sequential", () => {
    const plan = {
      ...validPlan,
      agentsToHire: [{ ...validAgent, index: 1 }],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects when model is not in preset list", () => {
    const plan = {
      ...validPlan,
      agentsToHire: [{ ...validAgent, model: "gpt-4" }],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects when persona summary is too short", () => {
    const plan = {
      ...validPlan,
      agentsToHire: [{ ...validAgent, personaSummary: "Hi." }],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects when issue depends on its own index", () => {
    const plan = {
      ...validPlan,
      issuesToCreate: [{ ...validIssue, dependsOnIndexes: [0] }],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects when issue assigneeIndex references missing agent", () => {
    const plan = {
      ...validPlan,
      issuesToCreate: [{ ...validIssue, assigneeIndex: 99 }],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects when dependsOnIndexes references missing issue", () => {
    const plan = {
      ...validPlan,
      issuesToCreate: [{ ...validIssue, dependsOnIndexes: [99] }],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects when depends_on forms a cycle", () => {
    const plan = {
      ...validPlan,
      issuesToCreate: [
        { ...validIssue, index: 0, dependsOnIndexes: [1] },
        { ...validIssue, index: 1, dependsOnIndexes: [0] },
      ],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects when reports_to forms a cycle", () => {
    const plan = {
      ...validPlan,
      agentsToHire: [
        { ...validAgent, index: 0, reportsToIndex: 1 },
        { ...validAgent, index: 1, name: "Other", reportsToIndex: 0 },
      ],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("accepts 'CEO' literal in reportsToIndex and assigneeIndex", () => {
    const result = GoalPlanPayloadSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
  });

  it("rejects summary shorter than 20 chars", () => {
    const plan = { ...validPlan, summary: "tiny" };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects estimated_tokens of zero", () => {
    const plan = {
      ...validPlan,
      issuesToCreate: [{ ...validIssue, estimatedTokens: 0 }],
    };
    const result = GoalPlanPayloadSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("allows empty risks array", () => {
    const result = GoalPlanPayloadSchema.safeParse({ ...validPlan, risks: [] });
    expect(result.success).toBe(true);
  });

  it("rejects more than 10 risks", () => {
    const risks = Array.from({ length: 11 }, () => ({
      description: "x",
      mitigation: "y",
      severity: "low" as const,
    }));
    const result = GoalPlanPayloadSchema.safeParse({ ...validPlan, risks });
    expect(result.success).toBe(false);
  });
});
