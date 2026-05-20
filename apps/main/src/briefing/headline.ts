import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createCompaniesRepository } from "../companies/repository.js";
import { createCostsRepository } from "../costs/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import type { RunDerivationResult } from "../derivation/runner.js";

// M14 PR-C — generates the Vitrine's one-line headline via a `claude -p` call.
// Cached on `companies.briefing_headline_json` by hash of the input counters
// (stable JSON of the object below) so opening the page in the same state
// costs zero new calls. Cost recorded with adapter_name='briefing-headline'.
// On failure, returns a deterministic fallback and skips cache write so the
// next call retries.

const HEADLINE_MODEL = "claude-sonnet-4-6";

export interface BriefingCounters {
  verified: number;
  failed: number;
  needsYou: number;
  learned: number;
  inProgress: number;
  costCents: number;
}

export type GenerateBriefingHeadlineDeps = {
  db: Database.Database;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type GenerateBriefingHeadlineInput = {
  companyId: string;
  counters: BriefingCounters;
  env: Record<string, string>;
};

const buildPrompt = (counters: BriefingCounters): string =>
  [
    "You write a single short headline (max 20 words) summarising what an",
    "autonomous AI company did overnight. Be concrete, not promotional.",
    "Mention only what is non-zero. Output the headline alone — no quotes,",
    "no preamble, no commentary.",
    "",
    `Goals reached: ${counters.verified}`,
    `Verifications failed: ${counters.failed}`,
    `Items waiting on the user: ${counters.needsYou}`,
    `New skills learned: ${counters.learned}`,
    `In progress right now: ${counters.inProgress}`,
    `Cost spent (USD cents): ${counters.costCents}`,
  ].join("\n");

const stableHash = (counters: BriefingCounters): string => {
  // Fixed key order — do NOT rely on JSON.stringify object iteration.
  const stable = [
    counters.verified,
    counters.failed,
    counters.needsYou,
    counters.learned,
    counters.inProgress,
    counters.costCents,
  ].join("|");
  return createHash("sha256").update(stable).digest("hex");
};

const fallbackHeadline = (counters: BriefingCounters): string => {
  const parts: string[] = [];
  if (counters.verified > 0) parts.push(`${counters.verified} delivered`);
  if (counters.failed > 0) parts.push(`${counters.failed} failed`);
  if (counters.needsYou > 0) parts.push(`${counters.needsYou} need you`);
  if (counters.inProgress > 0) parts.push(`${counters.inProgress} in progress`);
  if (parts.length === 0) return "Quiet night.";
  return parts.join(" · ");
};

const stripQuotes = (s: string): string => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”"))) {
    return t.slice(1, -1).trim();
  }
  return t;
};

export const generateBriefingHeadline = async (
  deps: GenerateBriefingHeadlineDeps,
  input: GenerateBriefingHeadlineInput,
): Promise<string> => {
  const repo = createCompaniesRepository(deps.db);
  const hash = stableHash(input.counters);

  // Cache hit?
  const cachedRaw = repo.getBriefingHeadlineRaw(input.companyId);
  if (cachedRaw !== null) {
    try {
      const parsed = JSON.parse(cachedRaw) as { hash: string; text: string };
      if (parsed.hash === hash && typeof parsed.text === "string" && parsed.text.length > 0) {
        return parsed.text;
      }
    } catch {
      /* corrupted cache — fall through and regenerate */
    }
  }

  let text: string;
  try {
    const result = await deps.runDerivation({
      prompt: buildPrompt(input.counters),
      model: HEADLINE_MODEL,
      env: input.env,
    });
    text = stripQuotes(result.text);
    if (text === "") throw new Error("empty headline");

    // Record the cost (same pattern as telos-synthesis.ts).
    createCostsRepository(deps.db).insert({
      companyId: input.companyId,
      agentId: null,
      projectId: null,
      issueId: null,
      adapterName: "briefing-headline",
      model: HEADLINE_MODEL,
      sessionId: null,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      cacheCreationTokens: result.usage.cacheCreation,
      cacheReadTokens: result.usage.cacheRead,
      costCentsEstimate: estimateCostCents(HEADLINE_MODEL, {
        input: result.usage.input,
        output: result.usage.output,
        cache_creation: result.usage.cacheCreation,
        cache_read: result.usage.cacheRead,
      }),
      occurredAt: Date.now(),
    });

    repo.setBriefingHeadline(
      input.companyId,
      JSON.stringify({ hash, text, generatedAt: Date.now() }),
    );
    return text;
  } catch (err) {
    console.warn("[briefing] headline generation failed; using fallback", err);
    return fallbackHeadline(input.counters);
  }
};
