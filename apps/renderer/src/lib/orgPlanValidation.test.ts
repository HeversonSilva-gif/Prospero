import { describe, it, expect } from "vitest";
import type { OrgPlan } from "@prospero/shared";
import { validateOrgPlanSelection, type OrgPlanFilter } from "./orgPlanValidation.js";

const plan: OrgPlan = {
  id: "orgplan_1",
  companyId: "c1",
  proposedByAgentId: "ceo",
  summary: "s",
  roles: [
    {
      index: 0,
      name: "Manager",
      description: "d",
      charter: "# c",
      model: "claude-sonnet-4-6",
      capabilities: ["chat"],
      icon: null,
    },
    {
      index: 1,
      name: "Specialist",
      description: "d",
      charter: "# c",
      model: "claude-sonnet-4-6",
      capabilities: ["chat"],
      icon: null,
    },
  ],
  agents: [
    { index: 0, name: "Ann", roleIndex: 0, reportsToIndex: "CEO", rationale: "r" },
    { index: 1, name: "Bob", roleIndex: 1, reportsToIndex: 0, rationale: "r" },
  ],
  status: "proposed",
  userFeedback: null,
  proposedAt: 0,
  decidedAt: null,
};

const all: OrgPlanFilter = {
  includedRoleIndexes: new Set([0, 1]),
  includedAgentIndexes: new Set([0, 1]),
};

describe("validateOrgPlanSelection", () => {
  it("returns no errors when everything is included", () => {
    expect(validateOrgPlanSelection(plan, all)).toEqual([]);
  });

  it("flags an included agent whose role is excluded", () => {
    const errors = validateOrgPlanSelection(plan, {
      includedRoleIndexes: new Set([0]),
      includedAgentIndexes: new Set([0, 1]),
    });
    expect(errors).toContainEqual({ kind: "agent-role-excluded", agentIndex: 1, roleIndex: 1 });
  });

  it("flags an included agent whose reports-to is excluded", () => {
    const errors = validateOrgPlanSelection(plan, {
      includedRoleIndexes: new Set([0, 1]),
      includedAgentIndexes: new Set([1]),
    });
    expect(errors).toContainEqual({
      kind: "agent-reports-to-excluded",
      agentIndex: 1,
      reportsToIndex: 0,
    });
  });

  it("ignores excluded agents", () => {
    expect(
      validateOrgPlanSelection(plan, {
        includedRoleIndexes: new Set([0]),
        includedAgentIndexes: new Set([0]),
      }),
    ).toEqual([]);
  });
});
