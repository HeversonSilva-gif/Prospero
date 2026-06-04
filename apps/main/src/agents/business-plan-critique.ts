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
    "  The `ownerProfile` must reflect a real owner interview (how the owner communicates,",
    "  what they value, time, risk appetite). An absent, empty, or trivially short",
    "  ownerProfile means the interview was skipped — flag it as not specific.",
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
    "  EVERY option's `ownerProfile` must reflect a real owner interview. An absent, empty,",
    "  or trivially short ownerProfile on ANY option means the interview was skipped — flag",
    "  the set as not specific.",
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

// Bracket-scan for the first {...} — robust to code fences (```json / ```JSON),
// CRLF, and surrounding prose. The old anchored fence-strip required the WHOLE
// response to be exactly a lowercase-```fence; anything else made JSON.parse
// throw and the critic fail-OPEN, silently approving a flagged plan. Mirrors
// the other critics. Audit 2026-06-03 Facet 6 I2.
const extractJson = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

// I6 (audit 2026-06-04) — minimum length below which an ownerProfile is treated
// as "the interview did not capture the owner". A real profile is a sentence or
// two; anything shorter is effectively empty.
const MIN_OWNER_PROFILE_LEN = 20;

const ownerProfileMissing = (profile: string | null | undefined): boolean =>
  profile === null || profile === undefined || profile.trim().length < MIN_OWNER_PROFILE_LEN;

// I6 — deterministic emptiness check. Returns true if any plan/option lacks a
// real ownerProfile. The LLM critic is advisory; this runs regardless so an
// empty owner profile is ALWAYS flagged (the interview was skipped), and a
// garbled verdict (missing `feasible`) cannot launder it through.
const anyOwnerProfileMissing = (
  input: BusinessPlanCritiqueInput | BusinessPlanOptionsCritiqueInput,
): boolean =>
  "options" in input
    ? input.options.some((o) => ownerProfileMissing(o.ownerProfile))
    : ownerProfileMissing(input.plan.ownerProfile);

// Fail-open on RUNNER errors (a runner throw never blocks genesis) but with
// teeth on emptiness: an absent/trivial ownerProfile is flagged deterministically
// (not feasible + not specific), and a missing/garbled `feasible` field is treated
// as NOT feasible for that dimension rather than silently passing.
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
  const ownerMissing = anyOwnerProfileMissing(input);
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
    const parsed = (extractJson(result.text) ?? {}) as Partial<BusinessPlanVerdict>;
    const criticFeedback = typeof parsed.feedback === "string" ? parsed.feedback : "";
    if (ownerMissing) {
      // Deterministic teeth: the interview did not capture the owner. Treat a
      // missing/garbled `feasible` as NOT feasible for this dimension, and force
      // not-specific so the plan is surfaced for revision instead of passing.
      const ownerNote =
        "The ownerProfile is missing or too short — the owner interview was not captured. Interview the owner and fill ownerProfile on every option.";
      return {
        feasible: parsed.feasible === true,
        specific: false,
        feedback: criticFeedback === "" ? ownerNote : `${criticFeedback} ${ownerNote}`,
      };
    }
    return {
      feasible: parsed.feasible !== false,
      specific: parsed.specific !== false,
      feedback: criticFeedback,
    };
  } catch {
    // Fail-open on runner errors so a critic hiccup never deadlocks genesis. But an
    // empty ownerProfile is a DETERMINISTIC signal that doesn't depend on the critic
    // call, so keep its teeth even when the runner threw — surfaced for revision, not
    // a deadlock (a human still gates approval). (review 2026-06-04)
    if (ownerMissing) {
      return {
        feasible: false,
        specific: false,
        feedback:
          "The ownerProfile is missing or too short — the owner interview was not captured. Interview the owner and fill ownerProfile on every option.",
      };
    }
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
