import type { RunDerivationResult } from "../derivation/runner.js";
import type { BusinessPlanPayload } from "../schemas/businessPlan.js";
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

const stripFence = (text: string): string => {
  const t = text.trim();
  const m = /^```[a-z]*\n([\s\S]*)\n```$/.exec(t);
  return m !== null ? m[1]!.trim() : t;
};

// Fail-open: any error (runner throw, non-JSON, missing fields) yields a passing
// verdict so a critic hiccup never blocks genesis.
export const critiqueBusinessPlan = async (
  deps: BusinessPlanCritiqueDeps,
  input: BusinessPlanCritiqueInput,
): Promise<BusinessPlanVerdict> => {
  try {
    const result = await deps.runDerivation({
      prompt: buildBusinessPlanCritiquePrompt(input.plan, input.capabilityBoundary),
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
};

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
