import type Database from "better-sqlite3";
import { CHARTER_SECTIONS } from "@prospero/shared";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
import { createCostsRepository } from "../costs/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import { CHARTER_DEPTH_EXEMPLAR } from "./charter-exemplar.js";
import type { RunDerivationResult } from "../derivation/runner.js";

// One-shot charter generation. Builds a generation prompt, runs a headless
// `claude -p` call (reusing the M11 derivation runner), sanitizes the result,
// records a cost event, and returns the charter markdown for the user to
// review and edit in the charter editor.

// Sonnet — same model the derivation pipeline uses: good enough for structured
// generation, far cheaper than Opus.
const GENERATION_MODEL = "claude-sonnet-4-6";

// Builds the single prompt string fed to the headless runner (which reads the
// whole prompt from stdin — there is no separate --system-prompt). Includes the
// 8-section spec, the depth exemplar (as a "match depth, not domain" reference),
// the real business context, and optional regeneration feedback.
export const buildCharterGenerationPrompt = (
  description: string,
  businessContext: string,
  feedback?: string,
): string => {
  const sections = CHARTER_SECTIONS.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const businessBlock =
    businessContext.trim() !== ""
      ? [
          "This is the business the role serves — anchor the charter to it:",
          "",
          businessContext,
          "",
        ]
      : [];
  const feedbackBlock =
    feedback !== undefined && feedback.trim() !== ""
      ? [
          "A reviewer found the previous draft too generic or shallow. Fix this:",
          feedback.trim(),
          "",
        ]
      : [];
  return [
    "You are an expert at writing role charters for a company of AI agents.",
    "",
    "A charter is a markdown document with exactly these 8 level-2 (`## `)",
    "sections, in this order:",
    sections,
    "",
    "Here is an expert charter — match the DEPTH, not the domain or wording.",
    "Write for the role you are given, not for this example.",
    "",
    CHARTER_DEPTH_EXEMPLAR.trimEnd(),
    "",
    ...businessBlock,
    ...feedbackBlock,
    "Write a complete charter for the role described below, specific to this",
    "business — reference what it actually does, its audience, and its channel.",
    "Avoid archetype boilerplate that would fit any company. Keep it concrete and",
    "roughly 50-90 lines. Output ONLY the charter markdown — a `# ` title line",
    "followed by the eight `## ` sections. No preamble, no commentary, no code",
    "fences.",
    "",
    `Role description: ${description}`,
  ].join("\n");
};

// Removes a wrapping ```...``` fence if the model added one despite the prompt.
const stripCodeFence = (text: string): string => {
  const trimmed = text.trim();
  const m = /^```[a-z]*\n([\s\S]*)\n```$/.exec(trimmed);
  return m !== null ? m[1]!.trim() : trimmed;
};

export type GenerateCharterDeps = {
  db: Database.Database;
  // Injected so the module is testable without a real claude process. In
  // production this is the M11 derivation runner.
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type GenerateCharterInput = {
  description: string;
  businessContext: string;
  env: Record<string, string>;
  // Active company for the cost event; null skips cost recording.
  companyId: string | null;
  feedback?: string;
};

export const generateCharter = async (
  deps: GenerateCharterDeps,
  input: GenerateCharterInput,
): Promise<{ charter: string }> => {
  const description = input.description.trim();
  if (description === "") throw new Error("a role description is required");

  const result = await deps.runDerivation({
    prompt: buildCharterGenerationPrompt(description, input.businessContext, input.feedback),
    model: GENERATION_MODEL,
    env: input.env,
  });

  const charter = stripCodeFence(result.text);
  if (charter === "") throw new Error("charter generation produced no output");

  const check = sanitizeMemoryBody(charter);
  if (!check.ok) {
    throw new Error(`generated charter rejected by sanitizer: ${check.reason}`);
  }

  if (input.companyId !== null) {
    createCostsRepository(deps.db).insert({
      companyId: input.companyId,
      agentId: null,
      projectId: null,
      issueId: null,
      adapterName: "charter-generation",
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

  return { charter };
};
