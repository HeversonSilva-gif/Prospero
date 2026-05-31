import { describe, it, expect } from "vitest";
import {
  critiqueBusinessPlan,
  decideBusinessPlanOutcome,
  type BusinessPlanCritiqueDeps,
} from "./business-plan-critique.js";
import type { BusinessPlanPayload } from "../schemas/businessPlan.js";

const plan: BusinessPlanPayload = {
  concept: "A SaaS recipe assistant for people who work all day.",
  monetization: ["R$9/mo"],
  marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "later" },
  identity: { name: "Cozinha de 15", voice: "friendly", proposedXHandle: "@c15" },
  dropped: [],
};

const depsReturning = (text: string): BusinessPlanCritiqueDeps => ({
  runDerivation: () =>
    Promise.resolve({
      text,
      usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    }),
});

describe("critiqueBusinessPlan", () => {
  it("passes a feasible, specific plan", async () => {
    const v = await critiqueBusinessPlan(
      depsReturning('{"feasible":true,"specific":true,"feedback":""}'),
      { plan, capabilityBoundary: "boundary", env: {} },
    );
    expect(v.feasible).toBe(true);
    expect(v.specific).toBe(true);
  });
  it("flags an infeasible plan with feedback", async () => {
    const v = await critiqueBusinessPlan(
      depsReturning('{"feasible":false,"specific":true,"feedback":"needs design"}'),
      { plan, capabilityBoundary: "boundary", env: {} },
    );
    expect(v.feasible).toBe(false);
    expect(v.feedback).toContain("design");
  });
  it("fails open on a malformed critic response", async () => {
    const v = await critiqueBusinessPlan(depsReturning("not json"), {
      plan,
      capabilityBoundary: "b",
      env: {},
    });
    expect(v).toEqual({ feasible: true, specific: true, feedback: "" });
  });
  it("fails open when the runner throws", async () => {
    const v = await critiqueBusinessPlan(
      { runDerivation: () => Promise.reject(new Error("boom")) },
      { plan, capabilityBoundary: "b", env: {} },
    );
    expect(v.feasible).toBe(true);
  });
});

describe("decideBusinessPlanOutcome", () => {
  it("revises a flagged plan on the first attempt", () => {
    expect(decideBusinessPlanOutcome({ flagged: true, attempts: 0, cap: 1 })).toBe("revise");
  });
  it("cards a flagged plan once the cap is reached", () => {
    expect(decideBusinessPlanOutcome({ flagged: true, attempts: 1, cap: 1 })).toBe("card");
  });
  it("cards a clean plan immediately", () => {
    expect(decideBusinessPlanOutcome({ flagged: false, attempts: 0, cap: 1 })).toBe("card");
  });
});
