import type Database from "better-sqlite3";
import { ISA_SECTIONS, ISA_SKELETON } from "@prospero/shared";
import type {
  CriterionKind,
  CriterionCheckType,
  IsaDraft,
  ProposedCriterion,
} from "@prospero/shared";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
import { createCostsRepository } from "../costs/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import type { RunDerivationResult } from "../derivation/runner.js";

// One-shot ISA generation. Builds a prompt, runs a headless `claude -p` call
// (reusing the M11 derivation runner), parses a JSON envelope, sanitizes the
// result, records a cost event, and returns a draft for the user to review.
// Mirrors apps/main/src/agents/charter-generation.ts.

const GENERATION_MODEL = "claude-sonnet-4-6";

const ISA_EXAMPLE = `{
  "isa": "# Ideal State Artifact\\n\\n## Problem\\nThe signup funnel loses users at the email step.\\n\\n## Vision\\nA visitor completes signup in under 60 seconds with no dead ends.\\n\\n## Out of Scope\\nSocial login providers; password reset redesign.\\n\\n## Constraints\\nNo new third-party dependencies; ship within the sprint.\\n\\n## Criteria\\n<!-- ISCs -->\\n\\n## Verification Plan\\n<!-- ISCs -->\\n\\n## Decisions\\n_None yet._\\n\\n## Changelog\\n_Created._",
  "criteria": [
    { "statement": "The signup end-to-end test passes.", "kind": "deterministic", "checkType": "command" },
    { "statement": "The new flow feels effortless on mobile.", "kind": "judgment" }
  ]
}`;

// Builds the single prompt string fed to the headless runner.
export const buildIsaGenerationPrompt = (description: string): string => {
  const sections = ISA_SECTIONS.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return [
    "You are an expert at defining what 'done' means for a business goal.",
    "",
    "An ISA (Ideal State Artifact) is a markdown document with exactly these 8",
    "level-2 (`## `) sections, in order:",
    sections,
    "",
    "Sections 'Criteria' and 'Verification Plan' must contain only the literal",
    "marker `<!-- ISCs -->` — their content is rendered from a separate list.",
    "",
    "Here is the blank skeleton you must fill (keep the headings verbatim):",
    "",
    ISA_SKELETON,
    "",
    "Also propose 3-6 ISCs — verifiable criteria. Each has a `statement`, a",
    "`kind` ('deterministic' = machine-checkable, 'judgment' = needs review),",
    "and, for deterministic ones, a `checkType` ('command', 'metric' or",
    "'artifact_exists').",
    "",
    "Output ONLY a single JSON object, no commentary, no code fence, shaped",
    "exactly like this example:",
    "",
    ISA_EXAMPLE,
    "",
    `Goal description: ${description}`,
  ].join("\n");
};

// Removes a wrapping ```...``` fence if the model added one.
const stripCodeFence = (text: string): string => {
  const trimmed = text.trim();
  const m = /^```[a-z]*\n([\s\S]*)\n```$/.exec(trimmed);
  return m !== null ? m[1]!.trim() : trimmed;
};

const asKind = (v: unknown): CriterionKind =>
  v === "deterministic" ? "deterministic" : "judgment";

const asCheckType = (v: unknown): CriterionCheckType | undefined =>
  v === "command" || v === "metric" || v === "artifact_exists" ? v : undefined;

// Parses the model's JSON envelope into an IsaDraft. Drops empty-statement
// criteria. Throws when the envelope has no usable ISA body.
const parseDraft = (raw: string): IsaDraft => {
  let obj: unknown;
  try {
    obj = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("isa generation produced unparseable output");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("isa generation produced no JSON object");
  }
  const rec = obj as Record<string, unknown>;
  const isa = typeof rec["isa"] === "string" ? rec["isa"].trim() : "";
  if (isa === "") throw new Error("isa generation produced no ISA body");
  const rawCriteria = Array.isArray(rec["criteria"]) ? rec["criteria"] : [];
  const criteria: ProposedCriterion[] = rawCriteria
    .map((c): ProposedCriterion => {
      const r = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
      const statement = typeof r["statement"] === "string" ? r["statement"].trim() : "";
      const checkType = asCheckType(r["checkType"]);
      return checkType !== undefined
        ? { statement, kind: asKind(r["kind"]), checkType }
        : { statement, kind: asKind(r["kind"]) };
    })
    .filter((c) => c.statement !== "");
  return { isa, criteria };
};

export type GenerateIsaDeps = {
  db: Database.Database;
  // Injected so the module is testable without a real claude process. In
  // production this is the M11 derivation runner.
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type GenerateIsaInput = {
  description: string;
  env: Record<string, string>;
  companyId: string | null;
};

export const generateIsa = async (
  deps: GenerateIsaDeps,
  input: GenerateIsaInput,
): Promise<IsaDraft> => {
  const description = input.description.trim();
  if (description === "") throw new Error("a goal description is required");

  const result = await deps.runDerivation({
    prompt: buildIsaGenerationPrompt(description),
    model: GENERATION_MODEL,
    env: input.env,
  });

  const draft = parseDraft(result.text);

  const isaCheck = sanitizeMemoryBody(draft.isa);
  if (!isaCheck.ok) {
    throw new Error(`generated ISA rejected by sanitizer: ${isaCheck.reason}`);
  }
  for (const c of draft.criteria) {
    const check = sanitizeMemoryBody(c.statement);
    if (!check.ok) {
      throw new Error(`generated criterion rejected by sanitizer: ${check.reason}`);
    }
  }

  if (input.companyId !== null) {
    createCostsRepository(deps.db).insert({
      companyId: input.companyId,
      agentId: null,
      projectId: null,
      issueId: null,
      adapterName: "isa-generation",
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

  return draft;
};
