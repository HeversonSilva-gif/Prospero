import { describe, it, expect } from "vitest";
import { BusinessPlanPayloadSchema } from "./businessPlan.js";

const valid = {
  concept: "Cozinha de 15 — a SaaS recipe assistant for people who work all day and cannot cook.",
  monetization: ["Subscription R$9/mo via Stripe", "Free tier converts to paid"],
  marketing: {
    initialChannel: "x",
    tactics: ["5-step recipe threads daily", "weekly shopping list"],
    laterChannels: "Newsletter and others arrive as connectors ship.",
  },
  identity: {
    name: "Cozinha de 15",
    voice: "Friendly, short sentences.",
    proposedXHandle: "@cozinhade15",
  },
  dropped: [{ idea: "Recipe e-book", reason: "needs good visual design the AI cannot do alone" }],
};

describe("BusinessPlanPayloadSchema", () => {
  it("accepts a well-formed plan", () => {
    expect(BusinessPlanPayloadSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a non-x initial channel", () => {
    const bad = { ...valid, marketing: { ...valid.marketing, initialChannel: "tiktok" } };
    expect(BusinessPlanPayloadSchema.safeParse(bad).success).toBe(false);
  });
  it("requires at least one monetization line and one tactic", () => {
    expect(BusinessPlanPayloadSchema.safeParse({ ...valid, monetization: [] }).success).toBe(false);
    expect(
      BusinessPlanPayloadSchema.safeParse({
        ...valid,
        marketing: { ...valid.marketing, tactics: [] },
      }).success,
    ).toBe(false);
  });
  it("requires a non-empty brand name and handle", () => {
    const bad = { ...valid, identity: { ...valid.identity, name: "" } };
    expect(BusinessPlanPayloadSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts an optional structured pricing model", () => {
    const withPricing = {
      ...valid,
      pricing: {
        model: "subscription",
        items: [
          {
            name: "Plano mensal",
            description: "Acesso completo ao assistente",
            amount: 900,
            currency: "brl",
            interval: "month",
          },
        ],
        rationale: "Receita recorrente previsível para um SaaS.",
      },
    };
    expect(BusinessPlanPayloadSchema.safeParse(withPricing).success).toBe(true);
  });
  it("accepts an optional ownerProfile string", () => {
    expect(
      BusinessPlanPayloadSchema.safeParse({
        ...valid,
        ownerProfile: "Direto, valoriza simplicidade.",
      }).success,
    ).toBe(true);
  });
  it("accepts an optional research block with real competitors", () => {
    const withResearch = {
      ...valid,
      research: {
        competitors: [{ name: "Yummly", what: "recipe app", price: "free + premium" }],
        differentiation: "Foco em quem trabalha o dia todo e cozinha em 15 min.",
      },
    };
    expect(BusinessPlanPayloadSchema.safeParse(withResearch).success).toBe(true);
  });
  it("rejects research with no competitors or empty differentiation", () => {
    expect(
      BusinessPlanPayloadSchema.safeParse({
        ...valid,
        research: { competitors: [], differentiation: "x" },
      }).success,
    ).toBe(false);
    expect(
      BusinessPlanPayloadSchema.safeParse({
        ...valid,
        research: { competitors: [{ name: "A", what: "b" }], differentiation: "" },
      }).success,
    ).toBe(false);
  });
  it("rejects pricing with a non-3-letter currency or non-positive amount", () => {
    const base = {
      name: "X",
      description: "Y",
      currency: "brl",
      amount: 900,
    };
    const bad1 = {
      ...valid,
      pricing: { model: "one_time", items: [{ ...base, currency: "reais" }], rationale: "r" },
    };
    const bad2 = {
      ...valid,
      pricing: { model: "one_time", items: [{ ...base, amount: 0 }], rationale: "r" },
    };
    expect(BusinessPlanPayloadSchema.safeParse(bad1).success).toBe(false);
    expect(BusinessPlanPayloadSchema.safeParse(bad2).success).toBe(false);
  });
});
