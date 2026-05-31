import type { BusinessPlan } from "@prospero/shared";
import type { TelosInterviewAnswers } from "@prospero/shared";

// Pure mapping from an approved business plan into the 5 TELOS interview answers,
// which synthesizeTelos turns into the telos.md. Keeps the synthesized TELOS
// grounded in the plan and the two invariants.
export const businessPlanToTelosAnswers = (plan: BusinessPlan): TelosInterviewAnswers => ({
  purpose: plan.concept,
  growth: [
    "How the business should grow and make money:",
    ...plan.monetization.map((m) => `- ${m}`),
  ].join("\n"),
  principles: `Brand voice and how we operate: ${plan.identity.voice}`,
  idealState: [
    `${plan.identity.name} running smoothly: the product is live and maintained,`,
    `and the first marketing channel (X) brings a steady audience.`,
  ].join(" "),
  nonGoals: [
    "What this business will NOT become:",
    "- It does not depend on X — X is only the first marketing channel.",
    ...plan.dropped.map((d) => `- Not: ${d.idea} (${d.reason})`),
  ].join("\n"),
});
