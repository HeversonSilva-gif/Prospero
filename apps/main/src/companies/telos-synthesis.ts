import type Database from "better-sqlite3";
import { TELOS_SECTIONS, TELOS_SKELETON, validateTelos } from "@prospero/shared";
import type { TelosDraft, TelosInterviewAnswers } from "@prospero/shared";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
import { createCostsRepository } from "../costs/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import type { RunDerivationResult } from "../derivation/runner.js";

// One-shot TELOS synthesis. Builds a prompt from the user's interview answers,
// runs a headless `claude -p` call (reusing the M11 derivation runner),
// sanitizes the result, records a cost event, and returns the telos.md draft
// for the user to review and edit. Mirrors apps/main/src/agents/
// charter-generation.ts (plain-markdown output, not a JSON envelope).

const GENERATION_MODEL = "claude-sonnet-4-6";

// Builds the single prompt string fed to the headless runner.
export const buildTelosSynthesisPrompt = (answers: TelosInterviewAnswers): string => {
  const sections = TELOS_SECTIONS.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return [
    "You are an expert at articulating what a business exists for.",
    "",
    "A TELOS is a markdown document with exactly these 5 level-2 (`## `)",
    "sections, in order:",
    sections,
    "",
    "Here is the blank skeleton you must fill (keep the headings verbatim):",
    "",
    TELOS_SKELETON,
    "",
    "The business owner answered a short interview. Synthesize their answers",
    "into a clear, concrete TELOS. Keep it grounded — do not invent ambitions",
    "they did not express.",
    "",
    `What the business does, and for whom:\n${answers.purpose}`,
    "",
    `Where the business should be in 1-2 years:\n${answers.growth}`,
    "",
    `Non-negotiable principles / rules:\n${answers.principles}`,
    "",
    `The business running perfectly:\n${answers.idealState}`,
    "",
    `What the business explicitly should NOT become:\n${answers.nonGoals}`,
    "",
    "Output ONLY the TELOS markdown — a `# ` title line followed by the five",
    "`## ` sections. No preamble, no commentary, no code fences.",
  ].join("\n");
};

// I4 (audit 2026-06-04) — a deterministic, no-model fallback TELOS built straight
// from the interview answers. Used when the LLM synthesis fails (401 / rate-limit
// / empty / sanitizer-reject) so the company is never born without a purpose
// artifact. The 5 answers map 1:1 onto the 5 canonical TELOS sections. The
// assembled body is sanitized (the answers can carry un-sanitized genesis free
// text — audit I5); if it trips the sanitizer we degrade to the bare skeleton,
// which always validates and is always safe.
export const buildFallbackTelos = (answers: TelosInterviewAnswers): string => {
  const bodies: Record<(typeof TELOS_SECTIONS)[number], string> = {
    Mission: answers.purpose,
    "Long-term Goals": answers.growth,
    Principles: answers.principles,
    "Ideal State": answers.idealState,
    "Non-goals": answers.nonGoals,
  };
  const candidate =
    ["# Company TELOS", ...TELOS_SECTIONS.map((s) => `## ${s}\n\n${bodies[s].trim()}`)].join(
      "\n\n",
    ) + "\n";
  return sanitizeMemoryBody(candidate).ok ? candidate : TELOS_SKELETON;
};

// Removes a wrapping ```...``` fence if the model added one despite the prompt.
const stripCodeFence = (text: string): string => {
  const trimmed = text.trim();
  const m = /^```[a-z]*\n([\s\S]*)\n```$/.exec(trimmed);
  return m !== null ? m[1]!.trim() : trimmed;
};

export type SynthesizeTelosDeps = {
  db: Database.Database;
  // Injected so the module is testable without a real claude process. In
  // production this is the M11 derivation runner.
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type SynthesizeTelosInput = {
  answers: TelosInterviewAnswers;
  env: Record<string, string>;
  // Active company for the cost event; null skips cost recording.
  companyId: string | null;
};

export const synthesizeTelos = async (
  deps: SynthesizeTelosDeps,
  input: SynthesizeTelosInput,
): Promise<TelosDraft> => {
  const result = await deps.runDerivation({
    prompt: buildTelosSynthesisPrompt(input.answers),
    model: GENERATION_MODEL,
    env: input.env,
  });

  const telos = stripCodeFence(result.text);
  if (telos === "") throw new Error("telos synthesis produced no output");

  const check = sanitizeMemoryBody(telos);
  if (!check.ok) {
    throw new Error(`synthesized TELOS rejected by sanitizer: ${check.reason}`);
  }

  if (input.companyId !== null) {
    createCostsRepository(deps.db).insert({
      companyId: input.companyId,
      agentId: null,
      projectId: null,
      issueId: null,
      adapterName: "telos-synthesis",
      model: GENERATION_MODEL,
      sessionId: null,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      cacheCreationTokens: result.usage.cacheCreation,
      cacheReadTokens: result.usage.cacheRead,
      costCentsEstimate: estimateCostCents(GENERATION_MODEL, {
        input: result.usage.input,
        output: result.usage.output,
        cache_creation: result.usage.cacheCreation,
        cache_read: result.usage.cacheRead,
      }),
      occurredAt: Date.now(),
    });
  }

  // Advisory: surface any structural issues so the renderer can warn the user,
  // but still return the body so they can edit and save it.
  const validation = validateTelos(telos);
  const errors = validation.missing.map((s) => `Missing section: ${s}`);

  return {
    telos,
    ...(errors.length > 0 ? { error: errors } : {}),
  };
};
