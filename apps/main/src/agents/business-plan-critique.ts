import type { RunDerivationResult } from "../derivation/runner.js";
import type { BusinessPlanOption, BusinessPlanPayload } from "../schemas/businessPlan.js";
import { decidePlanOutcome } from "./plan-outcome.js";

const CRITIC_MODEL = "claude-sonnet-4-6";

export type BusinessPlanCritiqueDeps = {
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type BusinessPlanVerdict = { feasible: boolean; specific: boolean; feedback: string };

export type BusinessPlanCritiqueInput = {
  plan: BusinessPlanPayload;
  capabilityBoundary: string;
  env: Record<string, string>;
};

export type BusinessPlanOptionsCritiqueInput = {
  options: BusinessPlanOption[];
  capabilityBoundary: string;
  env: Record<string, string>;
};

export const buildBusinessPlanCritiquePrompt = (
  plan: BusinessPlanPayload,
  capabilityBoundary: string,
): string =>
  [
    "You are a hard-nosed reviewer of a one-person-business plan an AI team will run.",
    "",
    capabilityBoundary,
    "",
    "Judge the plan on two axes:",
    "- feasible: can the AI team BUILD, RUN, and MAINTAIN this with no human hands,",
    "  inside the capability boundary above? If it needs design, physical goods,",
    "  manual fulfillment, or the owner's labor, it is NOT feasible.",
    "- specific: is it concrete to a real business (not a generic template), with",
    "  plausible monetization and a coherent identity, and does it treat X as a",
    "  marketing channel rather than the business itself?",
    "  If a `pricing` model is present, it must be concrete: real `amount`s (not",
    "  placeholders), a `currency`, a `model` that matches its `items` (an `interval`",
    "  only on recurring items), and a rationale that fits the business. Flag vague or",
    "  inconsistent pricing as not specific.",
    "  If a `research` block is present, the competitors must be REAL and concrete (named",
    "  businesses, not 'various competitors') and the differentiation specific to this",
    "  business. Vague, empty, or invented research counts as not specific.",
    "",
    "The plan:",
    JSON.stringify(plan, null, 2),
    "",
    'Respond with ONLY a JSON object: {"feasible": boolean, "specific": boolean, "feedback": string}.',
    "feedback: one or two sentences on what to fix (empty string if both true).",
  ].join("\n");

export const buildBusinessPlanOptionsCritiquePrompt = (
  options: BusinessPlanOption[],
  capabilityBoundary: string,
): string => {
  const optionBlocks = options
    .map((opt, i) => {
      const label = opt.recommended ? `Option ${i + 1} [RECOMMENDED]` : `Option ${i + 1}`;
      return `${label}:\n${JSON.stringify(opt, null, 2)}`;
    })
    .join("\n\n");

  return [
    "You are a hard-nosed reviewer of a set of one-person-business options an AI team will run.",
    "",
    capabilityBoundary,
    "",
    "Judge the ENTIRE SET of options on two axes:",
    "- feasible: EVERY option must be buildable, runnable, and maintainable by the AI team",
    "  with NO human labor, inside the capability boundary above. If ANY option needs design,",
    "  physical goods, manual fulfillment, or the owner's labor, it is NOT feasible.",
    "  X is a marketing channel — it is NOT the business itself.",
    "- specific: EVERY option must have concrete, plausible monetization and a coherent identity.",
    "  If a `pricing` model is present, it must have real `amount`s (not placeholders), a",
    "  `currency`, a `model` matching its `items`, and a rationale that fits the business.",
    "  If a `research` block is present, competitors must be REAL named businesses (not 'various",
    "  competitors') and differentiation must be specific.",
    "  The option marked RECOMMENDED must be defensibly the best of the set — its rationale",
    "  (`whyRecommended`) must be coherent and distinguishing.",
    "  Signals (market/virality/community, 0-100) must be realistic — a set where every signal",
    "  is 90+ is NOT credible for a one-person AI-run business. Flag inflated signals.",
    "  Revenue projections (month3/month6/month12) must be plausible for a bootstrapped",
    "  one-person AI business; projections that are clearly unrealistic count as not specific.",
    "",
    "The options:",
    optionBlocks,
    "",
    'Respond with ONLY a JSON object: {"feasible": boolean, "specific": boolean, "feedback": string}.',
    "feedback: one or two sentences on what to fix across the set (empty string if both true).",
  ].join("\n");
};

const stripFence = (text: string): string => {
  const t = text.trim();
  const m = /^```[a-z]*\n([\s\S]*)\n```$/.exec(t);
  return m !== null ? m[1]!.trim() : t;
};

// Fail-open: any error (runner throw, non-JSON, missing fields) yields a passing
// verdict so a critic hiccup never blocks genesis.
export async function critiqueBusinessPlan(
  deps: BusinessPlanCritiqueDeps,
  input: BusinessPlanCritiqueInput,
): Promise<BusinessPlanVerdict>;
export async function critiqueBusinessPlan(
  deps: BusinessPlanCritiqueDeps,
  input: BusinessPlanOptionsCritiqueInput,
): Promise<BusinessPlanVerdict>;
export async function critiqueBusinessPlan(
  deps: BusinessPlanCritiqueDeps,
  input: BusinessPlanCritiqueInput | BusinessPlanOptionsCritiqueInput,
): Promise<BusinessPlanVerdict> {
  try {
    const prompt =
      "options" in input
        ? buildBusinessPlanOptionsCritiquePrompt(input.options, input.capabilityBoundary)
        : buildBusinessPlanCritiquePrompt(input.plan, input.capabilityBoundary);
    const result = await deps.runDerivation({
      prompt,
      model: CRITIC_MODEL,
      env: input.env,
    });
    const parsed = JSON.parse(stripFence(result.text)) as Partial<BusinessPlanVerdict>;
    return {
      feasible: parsed.feasible !== false,
      specific: parsed.specific !== false,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
    };
  } catch {
    return { feasible: true, specific: true, feedback: "" };
  }
}

// Thin adapter over the shared decidePlanOutcome — flagged = not feasible OR not
// specific — preserving the "card" | "revise" contract for orchestrator-handlers.
export const decideBusinessPlanOutcome = (input: {
  flagged: boolean;
  attempts: number;
  cap: number;
}): "card" | "revise" =>
  decidePlanOutcome({
    flaggedCount: input.flagged ? 1 : 0,
    attempts: input.attempts,
    cap: input.cap,
  }) === "revise"
    ? "revise"
    : "card";
