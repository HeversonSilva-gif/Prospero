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
});
