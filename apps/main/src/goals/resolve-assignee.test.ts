import { describe, it, expect } from "vitest";
import { resolvePlanAssignee } from "./resolve-assignee.js";

const deps = {
  ceoId: "agent_ceo",
  companyId: "co_1",
  freshHire: (i: number) => (i === 0 ? "agent_hired0" : undefined),
  existingAgent: (id: string) =>
    id === "agent_existing"
      ? { companyId: "co_1", terminatedAt: null }
      : id === "agent_other_co"
        ? { companyId: "co_2", terminatedAt: null }
        : id === "agent_fired"
          ? { companyId: "co_1", terminatedAt: 123 }
          : null,
};

describe("resolvePlanAssignee", () => {
  it("resolves 'CEO' to the ceo id", () => {
    expect(resolvePlanAssignee("CEO", deps)).toBe("agent_ceo");
  });

  it("resolves a fresh-hire index to the hired agent id", () => {
    expect(resolvePlanAssignee(0, deps)).toBe("agent_hired0");
  });

  it("throws when a fresh-hire index was not hired (filtered out)", () => {
    expect(() => resolvePlanAssignee(1, deps)).toThrow(/assignee/i);
  });

  it("resolves an existing team member by id", () => {
    expect(resolvePlanAssignee({ existingAgentId: "agent_existing" }, deps)).toBe("agent_existing");
  });

  it("throws when the existing agent does not exist", () => {
    expect(() => resolvePlanAssignee({ existingAgentId: "agent_ghost" }, deps)).toThrow(
      /not found/i,
    );
  });

  it("throws when the existing agent belongs to another company", () => {
    expect(() => resolvePlanAssignee({ existingAgentId: "agent_other_co" }, deps)).toThrow(
      /company/i,
    );
  });

  it("throws when the existing agent is terminated", () => {
    expect(() => resolvePlanAssignee({ existingAgentId: "agent_fired" }, deps)).toThrow(
      /terminated/i,
    );
  });
});
