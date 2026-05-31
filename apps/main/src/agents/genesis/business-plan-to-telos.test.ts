import { describe, it, expect } from "vitest";
import { businessPlanToTelosAnswers } from "./business-plan-to-telos.js";
import type { BusinessPlan } from "@prospero/shared";

const plan = {
  concept: "A SaaS recipe assistant for people who work all day.",
  monetization: ["R$9/mo", "partnerships later"],
  marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "newsletter later" },
  identity: { name: "Cozinha de 15", voice: "friendly, short", proposedXHandle: "@c15" },
  dropped: [{ idea: "e-book", reason: "needs design" }],
} as BusinessPlan;

describe("businessPlanToTelosAnswers", () => {
  it("maps concept into purpose and voice into principles", () => {
    const a = businessPlanToTelosAnswers(plan);
    expect(a.purpose).toContain("recipe assistant");
    expect(a.principles).toContain("friendly, short");
  });
  it("rolls monetization into growth and dropped ideas into nonGoals", () => {
    const a = businessPlanToTelosAnswers(plan);
    expect(a.growth).toContain("R$9/mo");
    expect(a.nonGoals).toContain("e-book");
  });
  it("states the business does not depend on X (INV-1) in nonGoals", () => {
    expect(businessPlanToTelosAnswers(plan).nonGoals.toLowerCase()).toContain("depend on x");
  });
});
