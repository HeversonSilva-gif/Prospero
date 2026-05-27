import { describe, it, expect } from "vitest";
import { applyGovernance } from "./index.js";
import { DEFAULT_GOVERNANCE_CONFIG } from "@prospero/shared";
import type { GovernanceConfig } from "@prospero/shared";
import type { PolicyInput } from "./policies.js";

const at = (h: number, m = 0): Date => {
  const d = new Date(2026, 4, 27, h, m, 0, 0); // Wed 2026-05-27
  return d;
};

const cfg = (overrides: Partial<GovernanceConfig> = {}): GovernanceConfig => ({
  ...DEFAULT_GOVERNANCE_CONFIG,
  ...overrides,
});

const toolReq = (overrides: Partial<PolicyInput> = {}): PolicyInput => ({
  kind: "tool_call",
  toolName: "Read",
  ...overrides,
});

const fireReq = (): PolicyInput => ({ kind: "manager_request", managerTopic: "fire" });

describe("applyGovernance", () => {
  it("returns route with no relaxed flags by default", () => {
    expect(applyGovernance(toolReq(), cfg(), at(10))).toEqual({
      kind: "route",
      relaxedFires: false,
      relaxedBudgets: false,
    });
  });

  it("short-circuits to auto-approve when policy says so (independent of quiet hours)", () => {
    const v = applyGovernance(
      toolReq({ toolName: "Read" }),
      cfg({
        policies: {
          ...DEFAULT_GOVERNANCE_CONFIG.policies,
          autoApproveReadOnlyAcrossProjects: true,
        },
      }),
      at(22, 30),
    );
    expect(v.kind).toBe("auto-approve");
  });

  it("quiet hours boost relaxed flags via OR", () => {
    const v = applyGovernance(
      fireReq(),
      cfg({
        quietHours: {
          windows: [{ daysOfWeek: [3], startMinute: 22 * 60, endMinute: 8 * 60 }],
        },
      }),
      at(23, 0),
    );
    expect(v).toEqual({ kind: "route", relaxedFires: true, relaxedBudgets: true });
  });

  it("quiet hours don't activate outside the window", () => {
    const v = applyGovernance(
      fireReq(),
      cfg({
        quietHours: {
          windows: [{ daysOfWeek: [3], startMinute: 22 * 60, endMinute: 8 * 60 }],
        },
      }),
      at(14, 0),
    );
    expect(v).toEqual({ kind: "route", relaxedFires: false, relaxedBudgets: false });
  });

  it("policy relaxed flags OR with quiet-hours flags", () => {
    const v = applyGovernance(
      fireReq(),
      cfg({
        policies: { ...DEFAULT_GOVERNANCE_CONFIG.policies, ceoCanDecideFires: true },
      }),
      at(14, 0),
    );
    expect(v.kind).toBe("route");
    expect(v.kind === "route" && v.relaxedFires).toBe(true);
  });
});
