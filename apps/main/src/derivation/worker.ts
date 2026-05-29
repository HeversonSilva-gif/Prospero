import type Database from "better-sqlite3";
import type { RunDerivationResult } from "./runner.js";
import {
  buildIssueTrail,
  buildRecoveryTrail,
  buildGoalTrail,
  buildApprovalTrail,
} from "./trail.js";
import {
  buildIssuePrompt,
  buildRecoveryPrompt,
  buildRetrospectivePrompt,
  buildPreferencePrompt,
  buildVerificationFailedPrompt,
} from "./prompts.js";
import { buildVerificationFailedTrail } from "./verification-failed-trail.js";
import { parseDerivationOutput, parseMemoryDerivation } from "./parse-output.js";
import { createSkillCandidatesRepository } from "../memory/skill-candidates-repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createCostsRepository } from "../costs/repository.js";
import { createSettingsRepository } from "../settings/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";

// Model used for derivation — Sonnet, cheaper than the agents' Opus default (spec §2.1).
const DERIVATION_MODEL = "claude-sonnet-4-6";
// How many recent messages feed a recovery derivation prompt. ~12 messages is
// enough context to spot the error-and-fix without bloating the prompt past a
// couple thousand tokens (which would inflate the per-derivation cost).
const RECOVERY_TRAIL_LIMIT = 12;

// A unit of derivation work, enqueued by the dispatcher.
export type DerivationJob = {
  trigger:
    | "issue_done"
    | "recovery"
    | "goal_achieved"
    | "approval_rejected"
    | "verification_failed";
  companyId: string;
  agentId: string;
  sourceEventId: string;
  issueId?: string;
  goalId?: string;
  approvalId?: string;
  failedCriterionIds?: string[];
};

export type DerivationWorkerDeps = {
  db: Database.Database;
  // Injected so the worker is testable without a real claude process.
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
  now: () => number;
  // Resolves the auth env (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY).
  authEnv: () => Record<string, string>;
};

export type DerivationWorker = {
  processJob(job: DerivationJob): Promise<void>;
};

// Start of the UTC calendar day for a timestamp. The cap counts cost_events,
// and the whole costs subsystem buckets by UTC midnight — keeping the same
// boundary here makes the cap agree with what the /costs UI shows.
const startOfDayUtc = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const createDerivationWorker = (deps: DerivationWorkerDeps): DerivationWorker => {
  const { db } = deps;
  const capCountStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM cost_events
      WHERE agent_id = ? AND adapter_name = 'derivation' AND occurred_at >= ?`,
  );

  const log = (msg: string): void => {
    console.warn(`[derivation] ${msg}`);
  };

  const processJob = async (job: DerivationJob): Promise<void> => {
    try {
      const cap = createSettingsRepository(db).read().derivationsPerDayPerAgent;
      const used = (capCountStmt.get(job.agentId, startOfDayUtc(deps.now())) as { n: number }).n;
      if (used >= cap) {
        log(`cap reached for agent ${job.agentId} (${used}/${cap}) — skipping`);
        return;
      }

      let prompt: string;
      if (job.trigger === "issue_done") {
        if (job.issueId === undefined) {
          log("issue_done job has no issueId — skipping");
          return;
        }
        const trail = buildIssueTrail(db, job.issueId);
        if (trail === null) {
          log(`issue ${job.issueId} not found — skipping`);
          return;
        }
        prompt = buildIssuePrompt(trail);
      } else if (job.trigger === "recovery") {
        const trail = buildRecoveryTrail(db, job.agentId, RECOVERY_TRAIL_LIMIT);
        if (trail === null || trail.messages.length === 0) {
          log(`no recovery trail for agent ${job.agentId} — skipping`);
          return;
        }
        prompt = buildRecoveryPrompt(trail);
      } else if (job.trigger === "goal_achieved") {
        if (job.goalId === undefined) {
          log("goal_achieved job has no goalId — skipping");
          return;
        }
        const trail = buildGoalTrail(db, job.goalId);
        if (trail === null) {
          log(`goal ${job.goalId} not found — skipping`);
          return;
        }
        prompt = buildRetrospectivePrompt(trail);
      } else if (job.trigger === "approval_rejected") {
        if (job.approvalId === undefined) {
          log("approval_rejected job has no approvalId — skipping");
          return;
        }
        const trail = buildApprovalTrail(db, job.approvalId);
        if (trail === null) {
          log(`approval ${job.approvalId} not found — skipping`);
          return;
        }
        prompt = buildPreferencePrompt(trail);
      } else if (job.trigger === "verification_failed") {
        const trail = buildVerificationFailedTrail(
          db,
          job.goalId ?? "",
          job.failedCriterionIds ?? [],
        );
        if (trail === null) {
          log(`verification_failed: goal ${job.goalId ?? "(none)"} not found — skipping`);
          return;
        }
        if (trail.failed.length === 0) {
          log(`verification_failed: no failed criteria in payload — skipping`);
          return;
        }
        prompt = buildVerificationFailedPrompt(trail);
      } else {
        // Exhaustiveness guard: a trigger added to DerivationJob without a
        // branch here becomes a compile error rather than silently running
        // the wrong path.
        const unknown: never = job.trigger;
        log(`unknown trigger: ${String(unknown)} — skipping`);
        return;
      }

      const result = await deps.runDerivation({
        prompt,
        model: DERIVATION_MODEL,
        env: deps.authEnv(),
      });

      createCostsRepository(db).insert({
        companyId: job.companyId,
        agentId: job.agentId,
        projectId: null,
        issueId: job.issueId ?? null,
        adapterName: "derivation",
        model: DERIVATION_MODEL,
        sessionId: null,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cacheCreationTokens: result.usage.cacheCreation,
        cacheReadTokens: result.usage.cacheRead,
        costCentsEstimate: estimateCostCents(DERIVATION_MODEL, {
          input: result.usage.input,
          output: result.usage.output,
          cache_creation: result.usage.cacheCreation,
          cache_read: result.usage.cacheRead,
        }),
        occurredAt: deps.now(),
      });

      if (
        job.trigger === "issue_done" ||
        job.trigger === "recovery" ||
        job.trigger === "verification_failed"
      ) {
        const parsed = parseDerivationOutput(result.text);
        if (parsed.kind === "discard") {
          log(`agent ${job.agentId} ${job.trigger}: derivation discarded`);
          return;
        }
        const bodyCheck = sanitizeMemoryBody(parsed.draft.body);
        if (!bodyCheck.ok) {
          log(`sanitizer rejected derived body: ${bodyCheck.reason} — dropping`);
          return;
        }
        const descCheck = sanitizeMemoryBody(parsed.draft.description);
        if (!descCheck.ok) {
          log(`sanitizer rejected derived description: ${descCheck.reason} — dropping`);
          return;
        }
        const candidate = createSkillCandidatesRepository(db).create({
          companyId: job.companyId,
          agentId: job.agentId,
          sourceEventId: job.sourceEventId,
          trigger: job.trigger,
          proposedName: parsed.draft.name,
          proposedDescription: parsed.draft.description,
          proposedBody: parsed.draft.body,
        });
        createInboxRepository(db).create({
          companyId: job.companyId,
          kind: "skill_candidate_pending",
          actorId: job.agentId,
          title: `New skill candidate: ${parsed.draft.name}`,
          preview: parsed.draft.description,
          requiresAction: true,
          payloadJson: JSON.stringify({ candidateId: candidate.id }),
        });
        return;
      }

      // goal_achieved / approval_rejected → a memory row (no human review).
      const parsedMemory = parseMemoryDerivation(result.text);
      if (parsedMemory.kind === "discard") {
        log(`agent ${job.agentId} ${job.trigger}: memory derivation discarded`);
        return;
      }
      const memCheck = sanitizeMemoryBody(parsedMemory.body);
      if (!memCheck.ok) {
        log(`sanitizer rejected derived memory: ${memCheck.reason} — dropping`);
        return;
      }
      if (job.trigger === "goal_achieved") {
        createMemoriesRepository(db).create({
          companyId: job.companyId,
          agentId: null,
          kind: "retrospective",
          body: parsedMemory.body,
          sourceEventId: job.sourceEventId,
        });
        createInboxRepository(db).create({
          companyId: job.companyId,
          kind: "goal_retrospective_ready",
          title: "New goal retrospective",
          preview: parsedMemory.body.slice(0, 200),
          requiresAction: false,
          payloadJson: JSON.stringify({ goalId: job.goalId }),
        });
      } else {
        createMemoriesRepository(db).create({
          companyId: job.companyId,
          agentId: job.agentId,
          kind: "preference",
          body: parsedMemory.body,
          sourceEventId: job.sourceEventId,
        });
      }
    } catch (err) {
      log(`job failed for agent ${job.agentId}: ${String(err)}`);
    }
  };

  return { processJob };
};
