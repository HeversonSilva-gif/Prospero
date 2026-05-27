import { describe, it, expect } from "vitest";
import { evaluatePolicies, type PolicyInput } from "./policies.js";
import { DEFAULT_GOVERNANCE_CONFIG } from "@prospero/shared";

const defaults = DEFAULT_GOVERNANCE_CONFIG.policies;

const toolCall = (overrides: Partial<PolicyInput> = {}): PolicyInput => ({
  kind: "tool_call",
  toolName: "Read",
  ...overrides,
});

const managerReq = (overrides: Partial<PolicyInput> = {}): PolicyInput => ({
  kind: "manager_request",
  managerTopic: "fire",
  ...overrides,
});

describe("evaluatePolicies", () => {
  it("defaults to route with no relaxed flags", () => {
    const v = evaluatePolicies(toolCall(), defaults);
    expect(v).toEqual({ kind: "route", relaxedFires: false, relaxedBudgets: false });
  });

  it("auto-approves read-only tool when policy enabled", () => {
    const v = evaluatePolicies(toolCall({ toolName: "Read" }), {
      ...defaults,
      autoApproveReadOnlyAcrossProjects: true,
    });
    expect(v.kind).toBe("auto-approve");
  });

  it("does NOT auto-approve write-tool even when read-only policy enabled", () => {
    const v = evaluatePolicies(toolCall({ toolName: "Write" }), {
      ...defaults,
      autoApproveReadOnlyAcrossProjects: true,
    });
    expect(v.kind).toBe("route");
  });

  it("never auto-approves manager_request regardless of read-only policy", () => {
    const v = evaluatePolicies(managerReq({ managerTopic: "fire" }), {
      ...defaults,
      autoApproveReadOnlyAcrossProjects: true,
    });
    expect(v.kind).toBe("route");
  });

  it("auto-approves cost request below the cap", () => {
    const v = evaluatePolicies(toolCall({ kind: "tool_call", estimatedSpendUsd: 0.5 }), {
      ...defaults,
      autoApproveSpendUnderUsdPerDay: 1.0,
      autoApproveReadOnlyAcrossProjects: false,
    });
    expect(v.kind).toBe("auto-approve");
  });

  it("does not auto-approve when spend exceeds the cap", () => {
    const v = evaluatePolicies(toolCall({ estimatedSpendUsd: 2.0 }), {
      ...defaults,
      autoApproveSpendUnderUsdPerDay: 1.0,
    });
    expect(v.kind).toBe("route");
  });

  it("ceoCanDecideFires=true sets relaxedFires=true on manager_request", () => {
    const v = evaluatePolicies(managerReq({ managerTopic: "fire" }), {
      ...defaults,
      ceoCanDecideFires: true,
    });
    expect(v).toEqual({ kind: "route", relaxedFires: true, relaxedBudgets: false });
  });

  it("ceoCanDecideBudgetOverruns=true sets relaxedBudgets=true on manager_request", () => {
    const v = evaluatePolicies(managerReq({ budgetOverLimit: true }), {
      ...defaults,
      ceoCanDecideBudgetOverruns: true,
    });
    expect(v).toEqual({ kind: "route", relaxedFires: false, relaxedBudgets: true });
  });

  it("does not produce auto-deny — only auto-approve or route", () => {
    const v = evaluatePolicies(toolCall(), defaults);
    expect(["auto-approve", "route"]).toContain(v.kind);
  });
});
