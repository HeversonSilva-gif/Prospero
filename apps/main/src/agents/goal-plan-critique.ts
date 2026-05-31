import type Database from "better-sqlite3";
import { createCostsRepository } from "../costs/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import type { RunDerivationResult } from "../derivation/runner.js";

// Judges a goal plan's issues for vagueness (no concrete scope / no clear
// "done-when") given the goal. Headless Sonnet, fail-open: any error or
// unparseable verdict yields zero vague issues so a critic hiccup never blocks
// planning. One call judges all issues together.

const CRITIC_MODEL = "claude-sonnet-4-6";

export type VagueIssue = { title: string; feedback: string };

export type IssueLite = { title: string; description: string };

export const buildIssueCritiquePrompt = (
  goalTitle: string,
  goalDescription: string,
  issues: IssueLite[],
): string =>
  [
    "You are a strict reviewer of a project plan's issues (tasks).",
    "Flag an issue as VAGUE when it lacks a concrete deliverable or a clear",
    '"done-when" — i.e. an engineer could not tell when it is finished, or it is',
    "an umbrella task hiding several jobs.",
    "",
    `Goal: ${goalTitle}`,
    goalDescription.trim() === "" ? "" : `Goal detail: ${goalDescription}`,
    "",
    "Issues:",
    ...issues.map((i, n) => `${n + 1}. ${i.title} — ${i.description}`),
    "",
    'Reply with ONLY a JSON object: {"vagueIssues": [{"title": string, "feedback": string}]}.',
    "feedback is one short sentence telling the author how to make that issue",
    "concrete (scope + done-when). If every issue is concrete, return an empty array.",
  ].join("\n");

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

const coerce = (raw: unknown): VagueIssue[] => {
  if (raw === null || typeof raw !== "object") return [];
  const arr = (raw as { vagueIssues?: unknown }).vagueIssues;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (v): v is { title: string; feedback: string } =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as { title?: unknown }).title === "string" &&
        typeof (v as { feedback?: unknown }).feedback === "string",
    )
    .map((v) => ({ title: v.title, feedback: v.feedback }));
};

export type GoalPlanCritiqueDeps = {
  db: Database.Database;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type GoalPlanCritiqueInput = {
  goalTitle: string;
  goalDescription: string;
  issues: IssueLite[];
  env: Record<string, string>;
  companyId: string | null;
};

export const critiqueGoalPlan = async (
  deps: GoalPlanCritiqueDeps,
  input: GoalPlanCritiqueInput,
): Promise<{ vagueIssues: VagueIssue[] }> => {
  let result: RunDerivationResult;
  try {
    result = await deps.runDerivation({
      prompt: buildIssueCritiquePrompt(input.goalTitle, input.goalDescription, input.issues),
      model: CRITIC_MODEL,
      env: input.env,
    });
  } catch {
    return { vagueIssues: [] };
  }
  if (input.companyId !== null) {
    createCostsRepository(deps.db).insert({
      companyId: input.companyId,
      agentId: null,
      projectId: null,
      issueId: null,
      adapterName: "goal-plan-critic",
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
  return { vagueIssues: coerce(extractJson(result.text)) };
};
