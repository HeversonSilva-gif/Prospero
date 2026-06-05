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

describe("GoalPlanPayloadSchema — assigning issues to existing team members", () => {
  it("accepts an issue assigned to an existing agent via { existingAgentId }", () => {
    const result = GoalPlanPayloadSchema.safeParse({
      ...basePlan,
      issuesToCreate: [{ ...oneIssue, assigneeIndex: { existingAgentId: "agent_abc123" } }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an existing-agent ref with an empty id", () => {
    const result = GoalPlanPayloadSchema.safeParse({
      ...basePlan,
      issuesToCreate: [{ ...oneIssue, assigneeIndex: { existingAgentId: "" } }],
    });
    expect(result.success).toBe(false);
  });

  it("still rejects an out-of-range numeric assignee (no fresh hires to index)", () => {
    const result = GoalPlanPayloadSchema.safeParse({
      ...basePlan,
      issuesToCreate: [{ ...oneIssue, assigneeIndex: 0 }], // agentsToHire is empty → index 0 invalid
    });
    expect(result.success).toBe(false);
  });

  it("still accepts the CEO and a fresh-hire index (backward compatible)", () => {
    const ceo = GoalPlanPayloadSchema.safeParse(basePlan);
    expect(ceo.success).toBe(true);
    const withHire = GoalPlanPayloadSchema.safeParse({
      ...basePlan,
      agentsToHire: [
        {
          index: 0,
          name: "Dev",
          roleTemplateId: "role-engineer",
          model: "sonnet-4",
          personaSummary: "Builds the backend services.",
          capabilities: [],
          reportsToIndex: "CEO" as const,
          rationale: "need a dev",
        },
      ],
      issuesToCreate: [{ ...oneIssue, assigneeIndex: 0 }],
    });
    expect(withHire.success).toBe(true);
  });
});
