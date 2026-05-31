import { describe, it, expect } from "vitest";
import { OrgPlanPayloadSchema } from "./orgPlan.js";

const role = (index: number) => ({
  index,
  name: `Role ${index}`,
  description: "does things",
  charter: "# Role\n\n## Identity\n\nbody",
  model: "sonnet-4",
  capabilities: ["chat"],
  icon: null,
});

const agent = (index: number, roleIndex: number, reportsToIndex: number | "CEO") => ({
  index,
  name: `Agent ${index}`,
  roleIndex,
  reportsToIndex,
  rationale: "needed",
});

const validPlan = {
  summary: "A small traffic agency with a manager and one specialist.",
  roles: [role(0), role(1)],
  agents: [agent(0, 0, "CEO"), agent(1, 1, 0)],
};

describe("OrgPlanPayloadSchema", () => {
  it("accepts a valid plan", () => {
    expect(OrgPlanPayloadSchema.safeParse(validPlan).success).toBe(true);
  });

  it("rejects a duplicate role index", () => {
    const bad = { ...validPlan, roles: [role(0), role(0)] };
    expect(OrgPlanPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects non-sequential agent indexes", () => {
    const bad = { ...validPlan, agents: [agent(0, 0, "CEO"), agent(2, 1, 0)] };
    expect(OrgPlanPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an agent referencing an out-of-range role", () => {
    const bad = { ...validPlan, agents: [agent(0, 9, "CEO"), agent(1, 1, 0)] };
    expect(OrgPlanPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an agent reporting to an out-of-range agent", () => {
    const bad = { ...validPlan, agents: [agent(0, 0, "CEO"), agent(1, 1, 9)] };
    expect(OrgPlanPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a reportsTo cycle", () => {
    const bad = { ...validPlan, agents: [agent(0, 0, 1), agent(1, 1, 0)] };
    expect(OrgPlanPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty charter", () => {
    const bad = { ...validPlan, roles: [{ ...role(0), charter: "" }, role(1)] };
    expect(OrgPlanPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a plan with no roles or no agents", () => {
    expect(OrgPlanPayloadSchema.safeParse({ ...validPlan, roles: [] }).success).toBe(false);
    expect(OrgPlanPayloadSchema.safeParse({ ...validPlan, agents: [] }).success).toBe(false);
  });
});
