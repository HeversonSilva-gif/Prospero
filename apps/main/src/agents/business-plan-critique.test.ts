import { describe, it, expect } from "vitest";
import {
  critiqueBusinessPlan,
  decideBusinessPlanOutcome,
  buildBusinessPlanOptionsCritiquePrompt,
  type BusinessPlanCritiqueDeps,
} from "./business-plan-critique.js";
import type { BusinessPlanOption, BusinessPlanPayload } from "../schemas/businessPlan.js";

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

// ---------------------------------------------------------------------------
// Shared fixtures for the 3-options path
// ---------------------------------------------------------------------------

const baseOption = (
  overrides: Partial<BusinessPlanOption> & { recommended: boolean },
): BusinessPlanOption => ({
  concept: "A SaaS newsletter-writing assistant for busy founders.",
  monetization: ["R$29/mo per seat"],
  marketing: { initialChannel: "x", tactics: ["weekly threads"], laterChannels: "later SEO" },
  identity: { name: "Carta Rápida", voice: "crisp", proposedXHandle: "@cartarapida" },
  dropped: [],
  whyRecommended: overrides.recommended
    ? "Best balance of demand and AI-deliverable scope."
    : "Not chosen — narrower audience.",
  signals: { market: 70, virality: 65, community: 60, revenue12m: "R$15k" },
  projection: {
    month3: "R$1k",
    month6: "R$5k",
    month12: "R$15k",
    assumption: "50 paying users at R$29/mo by month 12",
  },
  ...overrides,
});

const solidOptions: BusinessPlanOption[] = [
  baseOption({ recommended: true }),
  baseOption({
    recommended: false,
    concept: "An AI social media scheduler for solopreneurs.",
    identity: { name: "AgendaBot", voice: "efficient", proposedXHandle: "@agendabot" },
  }),
  baseOption({
    recommended: false,
    concept: "An AI SEO brief generator for content creators.",
    identity: { name: "BriefLab", voice: "analytical", proposedXHandle: "@brieflab" },
  }),
];

const inflatedOptions: BusinessPlanOption[] = [
  baseOption({
    recommended: true,
    signals: { market: 99, virality: 99, community: 98, revenue12m: "R$500k" },
    projection: {
      month3: "R$50k",
      month6: "R$200k",
      month12: "R$500k",
      assumption: "viral growth",
    },
    whyRecommended: "Best option.",
  }),
  baseOption({
    recommended: false,
    signals: { market: 95, virality: 95, community: 93, revenue12m: "R$300k" },
  }),
];

describe("critiqueBusinessPlan — options path", () => {
  it("passes a solid 3-option set when the critic approves", async () => {
    const v = await critiqueBusinessPlan(
      depsReturning('{"feasible":true,"specific":true,"feedback":""}'),
      { options: solidOptions, capabilityBoundary: "boundary", env: {} },
    );
    expect(v.feasible).toBe(true);
    expect(v.specific).toBe(true);
    expect(v.feedback).toBe("");
  });

  it("flags an option set when the critic finds inflated signals / implausible projections", async () => {
    const v = await critiqueBusinessPlan(
      depsReturning(
        '{"feasible":true,"specific":false,"feedback":"signals are inflated and revenue projections are unrealistic for a one-person AI business"}',
      ),
      { options: inflatedOptions, capabilityBoundary: "boundary", env: {} },
    );
    expect(v.specific).toBe(false);
    expect(v.feedback).toContain("inflated");
  });

  it("flags an option set when the recommended option is not feasible", async () => {
    const v = await critiqueBusinessPlan(
      depsReturning(
        '{"feasible":false,"specific":true,"feedback":"recommended option requires physical fulfillment"}',
      ),
      { options: solidOptions, capabilityBoundary: "boundary", env: {} },
    );
    expect(v.feasible).toBe(false);
    expect(v.feedback).toContain("physical fulfillment");
  });

  it("fails open on malformed critic response for options path", async () => {
    const v = await critiqueBusinessPlan(depsReturning("not json"), {
      options: solidOptions,
      capabilityBoundary: "b",
      env: {},
    });
    expect(v).toEqual({ feasible: true, specific: true, feedback: "" });
  });

  it("fails open when the runner throws on the options path", async () => {
    const v = await critiqueBusinessPlan(
      { runDerivation: () => Promise.reject(new Error("boom")) },
      { options: solidOptions, capabilityBoundary: "b", env: {} },
    );
    expect(v.feasible).toBe(true);
  });
});

describe("buildBusinessPlanOptionsCritiquePrompt", () => {
  it("marks the recommended option with [RECOMMENDED]", () => {
    const prompt = buildBusinessPlanOptionsCritiquePrompt(solidOptions, "boundary");
    expect(prompt).toContain("[RECOMMENDED]");
    // Only one option should be marked
    const matches = prompt.match(/\[RECOMMENDED\]/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("includes all option indices", () => {
    const prompt = buildBusinessPlanOptionsCritiquePrompt(solidOptions, "boundary");
    expect(prompt).toContain("Option 1");
    expect(prompt).toContain("Option 2");
    expect(prompt).toContain("Option 3");
  });

  it("includes inflated-signals guidance", () => {
    const prompt = buildBusinessPlanOptionsCritiquePrompt(solidOptions, "boundary");
    expect(prompt).toContain("90+");
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
