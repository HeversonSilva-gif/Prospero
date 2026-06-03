import { describe, it, expect } from "vitest";
import { BusinessPlanOptionsPayloadSchema, BusinessPlanOptionSchema } from "./businessPlan.js";

// Minimal valid single-plan fields (mirrors businessPlan.test.ts `valid` fixture)
const basePlan = {
  concept: "Cozinha de 15 — a SaaS recipe assistant for people who work all day and cannot cook.",
  monetization: ["Subscription R$9/mo via Stripe"],
  marketing: {
    initialChannel: "x",
    tactics: ["5-step recipe threads daily"],
    laterChannels: "Newsletter arrives later.",
  },
  identity: {
    name: "Cozinha de 15",
    voice: "Friendly, short sentences.",
    proposedXHandle: "@cozinhade15",
  },
  dropped: [],
};

const signals = {
  market: 80,
  virality: 60,
  community: 55,
  revenue12m: "R$12k",
};

const projection = {
  month3: "R$1k",
  month6: "R$5k",
  month12: "R$12k",
  assumption: "Organic X growth, 0 paid ads.",
};

const optionA = {
  ...basePlan,
  recommended: true,
  whyRecommended: "Best market fit given owner profile.",
  signals,
  projection,
};

const optionB = {
  ...basePlan,
  concept: "Receitas Express — daily recipe newsletter monetised via sponsorships.",
  monetization: ["Sponsorships R$500/issue"],
  recommended: false,
  whyRecommended: "Lower effort but slower revenue ramp.",
  signals: { market: 70, virality: 75, community: 65, revenue12m: "R$8k" },
  projection: { month3: "R$500", month6: "R$3k", month12: "R$8k", assumption: "50 sponsors." },
};

const optionC = {
  ...basePlan,
  concept: "MealDrop BR — connecting home cooks with local buyers.",
  monetization: ["Commission 10% per transaction"],
  recommended: false,
  whyRecommended: "Marketplace model needs network effects.",
  signals: { market: 65, virality: 50, community: 80, revenue12m: "R$6k" },
  projection: { month3: "R$200", month6: "R$2k", month12: "R$6k", assumption: "20 active cooks." },
};

describe("BusinessPlanOptionSchema", () => {
  it("accepts a valid option with all required fields", () => {
    expect(BusinessPlanOptionSchema.safeParse(optionA).success).toBe(true);
  });

  it("rejects signals outside 0-100 range", () => {
    const bad = { ...optionA, signals: { ...signals, market: 101 } };
    expect(BusinessPlanOptionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects negative signal values", () => {
    const bad = { ...optionA, signals: { ...signals, virality: -1 } };
    expect(BusinessPlanOptionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects empty revenue12m string", () => {
    const bad = { ...optionA, signals: { ...signals, revenue12m: "" } };
    expect(BusinessPlanOptionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects empty whyRecommended", () => {
    const bad = { ...optionA, whyRecommended: "" };
    expect(BusinessPlanOptionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("BusinessPlanOptionsPayloadSchema", () => {
  it("accepts a valid 3-option payload with exactly one recommended", () => {
    const payload = { options: [optionA, optionB, optionC] };
    expect(BusinessPlanOptionsPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts a valid 2-option payload with exactly one recommended", () => {
    const payload = { options: [optionA, optionB] };
    expect(BusinessPlanOptionsPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("fails when 0 options are recommended", () => {
    const payload = {
      options: [
        { ...optionA, recommended: false },
        { ...optionB, recommended: false },
        { ...optionC, recommended: false },
      ],
    };
    const result = BusinessPlanOptionsPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("exactly one"))).toBe(true);
    }
  });

  it("fails when 2 options are recommended", () => {
    const payload = {
      options: [
        { ...optionA, recommended: true },
        { ...optionB, recommended: true },
        { ...optionC, recommended: false },
      ],
    };
    const result = BusinessPlanOptionsPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("exactly one"))).toBe(true);
    }
  });

  it("fails when only 1 option is provided (below minimum of 2)", () => {
    const payload = { options: [optionA] };
    expect(BusinessPlanOptionsPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("fails when 4 options are provided (above maximum of 3)", () => {
    const optionD = {
      ...optionA,
      concept: "Fourth option concept that is long enough to pass the minimum length check.",
      recommended: false,
      whyRecommended: "Extra option beyond the allowed maximum.",
    };
    const payload = {
      options: [
        { ...optionA, recommended: true },
        { ...optionB, recommended: false },
        { ...optionC, recommended: false },
        { ...optionD, recommended: false },
      ],
    };
    expect(BusinessPlanOptionsPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
