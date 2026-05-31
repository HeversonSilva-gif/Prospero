import type Database from "better-sqlite3";
import { createCostsRepository } from "../costs/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import type { RunDerivationResult } from "../derivation/runner.js";
import { generateCharter, type GenerateCharterDeps } from "./charter-generation.js";

// Judges whether a generated charter is SPECIFIC to the business (vs generic
// archetype boilerplate) and deep enough. Headless Sonnet — same model + runner
// as charter generation. Fail-open: any parse/shape failure returns a passing
// verdict so a critic hiccup never blocks charter creation.

const CRITIC_MODEL = "claude-sonnet-4-6";

export type CharterCritique = {
  specific: boolean;
  depthOk: boolean;
  genericFlags: string[];
  feedback: string;
};

const PASS: CharterCritique = { specific: true, depthOk: true, genericFlags: [], feedback: "" };

export const buildCritiquePrompt = (charter: string, businessContext: string): string =>
  [
    "You are a strict reviewer of role charters for a company of AI agents.",
    "Judge ONE charter on two axes:",
    "1. specific — does it reference THIS business (its product, audience, channel)",
    "   concretely, or is it generic archetype boilerplate that would fit any company?",
    "2. depthOk — are Operating Workflow, Domain Lenses, Quality Bar and Definition",
    "   of Done concrete and actionable (an expert's playbook, not a job description)?",
    "",
    "The business the charter must serve:",
    businessContext.trim() === "" ? "(no business context provided)" : businessContext,
    "",
    "The charter to judge:",
    "---",
    charter,
    "---",
    "",
    'Reply with ONLY a JSON object, no prose: {"specific": boolean, "depthOk": boolean,',
    '"genericFlags": string[], "feedback": string}. genericFlags lists what reads',
    "generic; feedback is one short paragraph telling the author how to make it",
    "specific and deep. If it is already specific and deep, set both true and",
    "feedback to an empty string.",
  ].join("\n");

// Pulls the first balanced {...} JSON object out of arbitrary model text.
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

const coerce = (raw: unknown): CharterCritique => {
  if (raw === null || typeof raw !== "object") return PASS;
  const o = raw as Record<string, unknown>;
  if (typeof o.specific !== "boolean" || typeof o.depthOk !== "boolean") return PASS;
  return {
    specific: o.specific,
    depthOk: o.depthOk,
    genericFlags: Array.isArray(o.genericFlags)
      ? o.genericFlags.filter((f): f is string => typeof f === "string")
      : [],
    feedback: typeof o.feedback === "string" ? o.feedback : "",
  };
};

export type CritiqueDeps = {
  db: Database.Database;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type CritiqueInput = {
  charter: string;
  businessContext: string;
  env: Record<string, string>;
  companyId: string | null;
};

export const critiqueCharter = async (
  deps: CritiqueDeps,
  input: CritiqueInput,
): Promise<CharterCritique> => {
  let result: RunDerivationResult;
  try {
    result = await deps.runDerivation({
      prompt: buildCritiquePrompt(input.charter, input.businessContext),
      model: CRITIC_MODEL,
      env: input.env,
    });
  } catch {
    return PASS; // fail-open: a critic failure must never block charter creation
  }

  if (input.companyId !== null) {
    createCostsRepository(deps.db).insert({
      companyId: input.companyId,
      agentId: null,
      projectId: null,
      issueId: null,
      adapterName: "charter-critic",
      model: CRITIC_MODEL,
      sessionId: null,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      cacheCreationTokens: result.usage.cacheCreation,
      cacheReadTokens: result.usage.cacheRead,
      costCentsEstimate: estimateCostCents(CRITIC_MODEL, {
        input: result.usage.input,
        output: result.usage.output,
        cache_creation: result.usage.cacheCreation,
        cache_read: result.usage.cacheRead,
      }),
      occurredAt: Date.now(),
    });
  }

  return coerce(extractJson(result.text));
};

// Max generation attempts. Attempt 1 = initial draft; attempt 2 = one targeted
// regeneration using the critic's feedback. Past the cap we return the best draft
// (the human still reviews it in the charter editor).
const DEEP_CAP = 2;

export type GenerateDeepInput = {
  description: string;
  businessContext: string;
  env: Record<string, string>;
  companyId: string | null;
};

export const generateCharterDeep = async (
  deps: GenerateCharterDeps & CritiqueDeps,
  input: GenerateDeepInput,
): Promise<{ charter: string; critique: CharterCritique }> => {
  let critique: CharterCritique = {
    specific: false,
    depthOk: false,
    genericFlags: [],
    feedback: "",
  };
  let charter = "";
  for (let attempt = 0; attempt < DEEP_CAP; attempt++) {
    const gen = await generateCharter(deps, {
      description: input.description,
      businessContext: input.businessContext,
      env: input.env,
      companyId: input.companyId,
      ...(attempt > 0 ? { feedback: critique.feedback } : {}),
    });
    charter = gen.charter;
    critique = await critiqueCharter(deps, {
      charter,
      businessContext: input.businessContext,
      env: input.env,
      companyId: input.companyId,
    });
    if (critique.specific && critique.depthOk) break;
  }
  return { charter, critique };
};
