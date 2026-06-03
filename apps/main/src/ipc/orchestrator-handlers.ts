import { ipcMain, BrowserWindow, app } from "electron";
import type Database from "better-sqlite3";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmdirSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { safeAppend } from "../logging/safe-log.js";
import {
  IPC,
  MODEL_ID_REGEX,
  type Agent,
  type AgentEvent,
  type AgentMode,
  type AgentStats,
  type BudgetPeriod,
  type Message,
  type MessageKind,
  type ToolCallView,
} from "@prospero/shared";
import { redactString } from "../auth/token-redact.js";
import { createAgentsRepository } from "../agents/repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { createMessagesRepository } from "../messages/repository.js";
import { buildContentBlocks, type LoadedAttachment } from "../messages/attachments.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { agentMemoryNearFull } from "../orchestrator/system-prompt-memory.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createRecoveryTracker } from "../orchestrator/recovery-tracker.js";
import { createNudgeTracker } from "../orchestrator/nudge.js";
import { getActiveAuthMode } from "../auth/auth-mode.js";
import {
  getAdapter,
  removeAdapter,
  activeAdapterCount,
  MAX_CONCURRENT_AGENTS,
  listAdapterAgentIds,
  type AdapterCallbacks,
} from "../orchestrator/lifecycle.js";
import { createRespawnFn, type PendingTurn, type SpawnState } from "../orchestrator/respawn.js";
import {
  mayOverwriteStatusOnLifecycleEvent,
  rememberPendingTurn,
} from "../orchestrator/lifecycle-guards.js";
import {
  setRecoveryBroadcastFn,
  setRecoveryPauseFn,
  setRespawnFn,
  setUserDataDir,
} from "../auth/credential-recovery.js";
import { computeLaneSchedule } from "../orchestrator/scheduler.js";
import { startSchedulerTick } from "../orchestrator/scheduler-tick.js";
import {
  computeReconcileDecision,
  type VerificationFailedGoal,
} from "../orchestrator/reconciler.js";
import { RETRY_CAP } from "../verification/index.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalPlansRepository } from "../goals/plans-repository.js";
import { critiqueGoalPlan } from "../agents/goal-plan-critique.js";
import { decidePlanOutcome } from "../agents/plan-outcome.js";
import { formatGoalPlanRequest } from "../goals/format-request.js";
import { createIssuesRepository } from "../issues/repository.js";
import { reactToIssueChange } from "../issues/react-to-change.js";
import { notifyAssignee } from "../issues/notify-assignee.js";
import { buildVerificationDeps } from "../verification/deps.js";
import { setRemoteExecutionConfigResolver } from "../orchestrator/adapters/claude-oauth-remote-docker/connection-manager.js";
import { toRemoteExecutionConfig } from "../orchestrator/adapters/claude-oauth-remote-docker/config.js";
import { pickAdapterForHire } from "../agents/hire-adapter.js";
import {
  testRemoteConnection,
  type TestConnectionResult,
} from "../orchestrator/adapters/claude-oauth-remote-docker/test-connection.js";
import { createRouter } from "../orchestrator/router.js";
import type { Router, Sender } from "../orchestrator/router.js";
import type { ParsedEvent } from "@prospero/shared";
import { mapToolUseToAction } from "../orchestrator/current-action-mapper.js";
import {
  createCurrentActionDebouncer,
  type CurrentActionDebouncer,
} from "../orchestrator/event-throttle.js";
import { getEventsDir } from "../orchestrator/events-dir.js";
import { registerGoalsHandlers } from "./goals-handlers.js";
import { registerNarratedHandlers } from "./goals-narrated-handlers.js";
import {
  scanPlanningWithoutPlan,
  resumeStuckNarrated,
  scanStrandedInProgress,
  scanProposedWithoutCard,
} from "../goals/recovery.js";
import { createSettingsRepository } from "../settings/repository.js";
import {
  startEventsWatcher,
  type AgentEvent as AgentSideEvent,
} from "../orchestrator/events-watcher.js";
import { broadcastIssueChanged } from "./issue-events-broadcast.js";
import {
  enqueueOrPark,
  drainPausedBacklog,
  pauseBacklog,
  pauseAndStopAgent,
} from "./agents-pause-backlog.js";
import { HIRE_FROM_UI_INPUT_SCHEMA } from "../schemas/hire-agent-input.js";
import { createCostsRepository } from "../costs/repository.js";
import { createBudgetsRepository } from "../costs/budgets-repository.js";
import { createCostRecorder, type CostsBroadcast } from "../costs/recorder.js";
import { checkAndPause, type EnforceBudgetDeps } from "../costs/enforce-budget.js";
import { rollUpYesterdayIfNeeded } from "../costs/day-summary.js";
import { createInboxRepository } from "../inbox/repository.js";
import { tryGetRoutinesEngine } from "../routines/index.js";
import { registerRoutinesHandlers } from "./routines-handlers.js";
import { createAutoModeExpiry } from "../agents/auto-mode-expiry.js";
import {
  setApprovalEngineBridge,
  tryGetApprovalTimers,
  escalatePendingOnBoot,
  armBouncesOnBoot,
} from "../approvals/index.js";
import { wakeCeoForApproval } from "../approvals/ceo-wake.js";
import { handleApprovalEvent } from "../approvals/event-handler.js";
import { createApprovalsRepository } from "../approvals/repository.js";
import { preapprovalKey, preapprovalPath } from "../approvals/deferred-approval.js";
import { getPermissionsDir } from "../security/permissions-dir.js";
import {
  createConnectionsRepository,
  listConnectedChannels,
} from "../connections/connections-repository.js";
import { handleXPostEvent } from "../connections/x-post-event.js";
import { handleStripeSetupEvent } from "../connections/stripe-setup-event.js";
import type { StripeChargeItem } from "../connections/stripe-monetization-executor.js";
import { handleCloudflareDeployEvent } from "../connections/cloudflare-deploy-event.js";
import { handleCloudflareD1Event } from "../connections/cloudflare-d1-event.js";
import { defaultWranglerRunner } from "../connections/wrangler-runner.js";
import { handleEmailSendEvent, handleEmailReadEvent } from "../connections/email-event.js";
import {
  defaultSmtpSend,
  defaultSmtpVerify,
  defaultImapFetch,
} from "../connections/email-transports.js";
import { safeStorageCipher, httpFetch } from "./connections-handlers.js";
import { getUserMetrics, getTweetMetrics } from "../connections/x-client.js";
import { listCharges } from "../connections/stripe-client.js";
import { createXPostsRepository } from "../connections/x-posts-repository.js";
import { createXMetricsRepository } from "../connections/x-metrics-repository.js";
import { createStripePaymentsRepository } from "../connections/stripe-payments-repository.js";
import { reviewFinance } from "../connections/finance-review.js";
import { collectXMetrics } from "../connections/collect-x-metrics.js";
import { collectStripeSales } from "../connections/collect-stripe-sales.js";
import { startXMetricsPoller } from "../connections/x-metrics-poller.js";
import { getValidXAccessToken } from "../connections/x-token-manager.js";
import { reviewXGrowth } from "../connections/x-growth-review.js";
import { broadcastInboxUpdate } from "./inbox-handlers.js";
import { isCeoAgent, findActiveCeo } from "@prospero/shared";
import { buildRecoveryTrail } from "../derivation/trail.js";
import { runDerivation, defaultRunProcess } from "../derivation/runner.js";
import { buildAuthEnv } from "../derivation/index.js";
import { createCompactionWorker } from "../context/compaction-worker.js";
import { shouldCompact } from "../context/should-compact.js";
import { hashSources } from "../context/freshness.js";
import { relativeDigestPath, projectDigestPath, agentDigestPath } from "../context/digest-dir.js";
import { compactionTarget } from "../context/compaction-target.js";
import { shouldResetSession } from "../context/compaction-decision.js";
import { estimateCostCents } from "../costs/pricing.js";
import { createOrgPlansRepository } from "../agents/org-plans-repository.js";
import { gatherBusinessContext } from "../agents/business-context.js";
import { critiqueOrgPlan, decideOrgPlanOutcome } from "../agents/org-plan-critique.js";
import { formatOrgPlanFeedback } from "../agents/format-org-feedback.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import {
  critiqueBusinessPlan,
  decideBusinessPlanOutcome,
} from "../agents/business-plan-critique.js";
import { formatBusinessPlanFeedback } from "../agents/format-business-plan-feedback.js";
import { buildCapabilityBoundary } from "../agents/genesis/capability-boundary.js";
import { BusinessPlanOptionsPayloadSchema } from "../schemas/businessPlan.js";

const broadcast = (event: AgentEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, event);
  }
};

// Mirrors orchestrator-level errors (spawn rejections, non-zero exits) into the
// shared prospero-debug.log. Pre-0.1.40 these went only to console.error — i.e.
// the Electron MAIN process stderr, which is captured NOWHERE in the packaged
// app — so a failed agent spawn was invisible (we couldn't see WHY it errored,
// the exact gap that made the 2026-05-30 stuck-agent triage a guessing game).
// safeAppend redacts secrets + the home path and rotates the file.
const olog = (msg: string): void => {
  try {
    safeAppend(
      join(app.getPath("userData"), "prospero-debug.log"),
      `[${new Date().toISOString()}] [orchestrator] ${msg}`,
    );
  } catch {
    /* best-effort — never let logging break the orchestrator */
  }
};

export const registerOrchestratorHandlers = (
  db: Database.Database,
): { stopScheduler: () => void; router: Router } => {
  const agents = createAgentsRepository(db, tryGetRecorder());

  // Runtime auto-heal (B, v0.1.40): per-agent count of error→idle heals since the
  // agent last exited cleanly. Caps respawn churn for a genuinely-broken agent —
  // after MAX it stays visible in `error` instead of looping. Cleared on a clean
  // (code 0) exit. See healErroredAgents() near the drain.
  const autoHealAttempts = new Map<string, number>();
  const MAX_AUTO_HEALS = 3;

  // Boot recovery: agents left in a transient/error state by a crash, an app
  // update restart, or the (now-fixed) config-change bug have no live process at
  // boot — reset them to idle so they are usable again. Paused/terminated stay.
  const stuckReset = agents.resetStuckAgents();
  if (stuckReset > 0) console.warn(`[boot] reset ${String(stuckReset)} stuck agent(s) to idle`);

  // Boot heal: a terminated agent whose status drifted to idle (the pre-fix
  // resume bug) is a "zombie" — it shows in the status-filtered roster and
  // silently swallows user messages. Force status back to 'terminated'.
  const zombiesHealed = agents.healTerminatedStatus();
  if (zombiesHealed > 0)
    console.warn(`[boot] healed ${String(zombiesHealed)} terminated-agent zombie(s)`);

  const messages = createMessagesRepository(db);
  const inbox = createInboxRepository(db);
  const costsRepo = createCostsRepository(db);
  const budgetsRepo = createBudgetsRepository(db);
  const settingsRepo = createSettingsRepository(db);

  // Remote execution config flows from Settings → the remote-docker transport.
  setRemoteExecutionConfigResolver(() =>
    toRemoteExecutionConfig(settingsRepo.read().remoteExecution),
  );

  // Debounced broadcast: aggregate costs:new deltas over 1s windows so the
  // renderer isn't bombarded after fast-firing turns.
  const pendingCosts = new Map<string, { tokens: number; cents: number }>();
  let costsBroadcastTimer: NodeJS.Timeout | null = null;
  const broadcastCostsDelta: CostsBroadcast = (payload) => {
    const existing = pendingCosts.get(payload.agentId) ?? { tokens: 0, cents: 0 };
    existing.tokens += payload.deltaTokens;
    existing.cents += payload.deltaCents;
    pendingCosts.set(payload.agentId, existing);
    if (costsBroadcastTimer === null) {
      costsBroadcastTimer = setTimeout(() => {
        for (const [agentId, agg] of pendingCosts.entries()) {
          broadcast({
            kind: "costs-new",
            agentId,
            deltaTokens: agg.tokens,
            deltaCents: agg.cents,
          });
        }
        pendingCosts.clear();
        costsBroadcastTimer = null;
      }, 1000);
    }
  };

  const costRecorder = createCostRecorder({
    costsRepo,
    broadcast: broadcastCostsDelta,
  });

  const enforceDeps: EnforceBudgetDeps = {
    costsRepo,
    budgetsRepo,
    pauseAgent: (agentId, reason) => {
      // Stop the running turn too — pausing the DB row alone lets the in-flight
      // turn keep spending. Kill + remove (onExit guard then keeps it "paused").
      pauseAndStopAgent(agentId, reason, {
        getAdapter,
        removeAdapter,
        pause: (id, r) => agents.pause(id, r),
      });
      broadcast({
        kind: "status-changed",
        agentId,
        status: "paused",
        updatedAt: Date.now(),
      });
    },
    notifySecurityAlert: (input) => {
      const limitDesc =
        input.reason === "budget_exceeded_daily"
          ? "diário"
          : input.reason === "budget_exceeded_issue"
            ? "por issue"
            : "do agente";
      const fmt = (v: number): string =>
        input.metric === "usd" ? `$${(v / 100).toFixed(2)}` : `${String(v)} tokens`;
      inbox.create({
        companyId: input.companyId,
        kind: "security_alert",
        actorId: input.agentId,
        title: `Budget ${limitDesc} excedido`,
        preview: `Agent gastou ${fmt(input.tokens)} (limite ${fmt(input.limit)})`,
        payloadJson: JSON.stringify(input),
        requiresAction: true,
      });
    },
    recordPauseActivity: (input) => {
      const rec = tryGetRecorder();
      if (rec === undefined) return;
      rec.recordActivity({
        companyId: input.companyId,
        actor: { kind: "system" },
        action: "agent.paused",
        entityKind: "agent",
        entityId: input.agentId,
        agentId: input.agentId,
        payload: { reason: input.reason },
      });
    },
    getBudgetState: (agentId) => agents.getBudgetState(agentId),
    markBudgetWarned: (agentId, key) => {
      agents.setBudgetWarnedPeriod(agentId, key);
    },
    notifyBudgetWarning: (input) => {
      const periodLabel = input.period === "daily" ? "diário" : "mensal";
      const fmt = (v: number): string =>
        input.metric === "tokens" ? `${String(v)} tokens` : `$${(v / 100).toFixed(2)}`;
      inbox.create({
        companyId: input.companyId,
        kind: "budget_warning",
        actorId: input.agentId,
        title: `Orçamento ${periodLabel} do agente em 80%`,
        preview: `Uso: ${fmt(input.used)} de ${fmt(input.limit)}`,
        payloadJson: JSON.stringify(input),
        requiresAction: false,
      });
    },
  };

  const currentActionDebouncer: CurrentActionDebouncer = createCurrentActionDebouncer(
    (agentId, action) => broadcast({ kind: "current-action-changed", agentId, action }),
    200,
  );

  const recoveryTracker = createRecoveryTracker();
  const nudgeTracker = createNudgeTracker();

  // Token-recovery v0.1.17: source-of-truth for "user input written to an agent
  // but not yet acknowledged by a turn-complete". Set right before sendInput
  // and cleared on turn-complete. After a respawn (auto-recovery on auth error,
  // or user-reconnect), createRespawnFn reads this map and re-emits so the
  // user's message still gets a response. Ephemeral, in-memory by design (a
  // crash drops pending turns — caller will retry).
  const pendingTurnByAgent = new Map<string, PendingTurn>();

  // Single canonical "write user input to the live adapter" entry point.
  // Extracted so the router callback AND the respawn re-emit path (via
  // RespawnDeps.writeStdin) both go through the same code — Task 11 will
  // extend this to load attachments by messageId and build content blocks.
  const writeStdinFn = (agentId: string, content: string, messageId: string | null): void => {
    const a = getAdapter(agentId);
    if (a === undefined || !a.isAlive()) return;
    // First-unanswered-write-wins: during a 401 the adapter stays alive through
    // the recovery debounce, so a 2nd message here must not clobber the first
    // still-unanswered turn that the respawn will replay. Cleared on
    // turn-complete. Audit 2026-06-03 Facet 1 C2.
    rememberPendingTurn(pendingTurnByAgent, agentId, { content, messageId });

    if (messageId === null) {
      a.sendInput(content);
      return;
    }

    const rows = db
      .prepare(
        `SELECT id, filename, mime_type as mimeType, local_path as localPath
           FROM message_attachments WHERE message_id = ?`,
      )
      .all(messageId) as Array<{
      id: string;
      filename: string;
      mimeType: string;
      localPath: string;
    }>;

    if (rows.length === 0) {
      a.sendInput(content);
      return;
    }

    const loaded: LoadedAttachment[] = [];
    for (const r of rows) {
      if (!existsSync(r.localPath)) {
        console.warn(`[attachments] missing file for ${r.id} at ${r.localPath}; skipping`);
        continue;
      }
      loaded.push({
        filename: r.filename,
        mimeType: r.mimeType,
        buffer: readFileSync(r.localPath),
      });
    }

    if (loaded.length === 0) {
      // All files were missing — fall back to text only.
      a.sendInput(content);
      return;
    }

    const blocks = buildContentBlocks(content, loaded);
    a.sendInput(blocks);
  };

  const router = createRouter({
    writeStdin: writeStdinFn,
    hasLiveAdapter: (id) => getAdapter(id)?.isAlive() ?? false,
    // Immediately drain when a message is held for an agent with no live adapter
    // (e.g. 4 idle-but-alive agents hold all slots and a 5th gets work). Without
    // this the slot frees only on the next 8s tick → up to 8s apparent latency.
    requestDrain: () => {
      drainScheduler();
    },
  });

  // P2 peça 2 — org-plan charter critic. Cap of 1 auto-revision per company: a
  // first generic submission earns one [ORG_PLAN_FEEDBACK] round-trip to the CEO;
  // the resubmission is surfaced regardless. In-memory, keyed by company; resets
  // on the card being created (and on restart — worst case one extra critique).
  const ORG_PLAN_REVISION_CAP = 1;
  const orgPlanRevisions = new Map<string, number>();

  // P2 peça C — goal-plan issue critic. Cap of 1 auto-revision per goal: a first
  // vague submission earns one [FEEDBACK] round-trip to the CEO; the resubmission
  // is surfaced regardless. In-memory, keyed by goalId; resets when the card is
  // created (and on restart — worst case one extra critique).
  const GOAL_PLAN_REVISION_CAP = 1;
  const goalPlanRevisions = new Map<string, number>();

  // P4.1 — business-plan critic. Cap of 1 auto-revision per company, same shape
  // as the org-plan critic. The counter is now DB-backed (business_plan_revisions)
  // so the cap survives restarts — the plan's critiquing/proposed status is
  // durable, so an in-memory counter made the cap bypassable. Audit Facet 6 C2.
  const BUSINESS_PLAN_REVISION_CAP = 1;

  const handleOrgProposed = async (orgPlanId: string, companyId: string): Promise<void> => {
    const orgPlans = createOrgPlansRepository(db);
    const plan = orgPlans.getById(orgPlanId);
    if (plan === null || plan.status !== "critiquing") return;
    const businessContext = gatherBusinessContext(db, app.getPath("userData"), companyId);
    const { genericRoles } = await critiqueOrgPlan(
      { db, runDerivation: (i) => runDerivation({ runProcess: defaultRunProcess }, i) },
      { roles: plan.roles, businessContext, env: buildAuthEnv(db), companyId },
    );
    const attempts = orgPlanRevisions.get(companyId) ?? 0;
    const outcome = decideOrgPlanOutcome({
      genericCount: genericRoles.length,
      attempts,
      cap: ORG_PLAN_REVISION_CAP,
    });
    if (outcome === "revise") {
      orgPlanRevisions.set(companyId, attempts + 1);
      // Leave the plan 'critiquing' (not superseded) — the CEO's resubmit supersedes
      // it via submit_org_plan's own prior-supersede logic. No card yet.
      deliverSystemMessage(plan.proposedByAgentId, formatOrgPlanFeedback(genericRoles));
      return;
    }
    orgPlanRevisions.delete(companyId);
    const note =
      genericRoles.length > 0 ? "⚠ Revisar — alguns charters podem estar genéricos. " : "";
    orgPlans.markProposed(orgPlanId);
    inbox.create({
      companyId,
      kind: "org_proposed",
      actorId: plan.proposedByAgentId,
      title: "Organization design proposed",
      preview: (note + plan.summary).slice(0, 200),
      requiresAction: true,
      payloadJson: JSON.stringify({ orgPlanId }),
    });
    broadcastInboxUpdate(companyId);
  };

  const handleBusinessPlanProposed = async (
    businessPlanId: string,
    companyId: string,
  ): Promise<void> => {
    const repo = createBusinessPlansRepository(db);
    const plan = repo.getById(businessPlanId);
    if (plan === null || plan.status !== "critiquing") return;
    const deps = {
      runDerivation: (i: { prompt: string; model: string; env: Record<string, string> }) =>
        runDerivation({ runProcess: defaultRunProcess }, i),
    };
    const parsedOptions =
      plan.options !== null
        ? BusinessPlanOptionsPayloadSchema.safeParse({ options: plan.options })
        : null;
    const verdict =
      parsedOptions !== null && parsedOptions.success
        ? await critiqueBusinessPlan(deps, {
            options: parsedOptions.data.options,
            capabilityBoundary: buildCapabilityBoundary(listConnectedChannels(db, companyId)),
            env: buildAuthEnv(db),
          })
        : await critiqueBusinessPlan(deps, {
            plan: {
              concept: plan.concept,
              monetization: plan.monetization,
              ...(plan.pricing !== null ? { pricing: plan.pricing } : {}),
              // Include research + ownerProfile so the critic can flag invented
              // competitors / vague differentiation (the prompt judges `research`
              // when present). Audit 2026-06-03 Facet 6 C1.
              ...(plan.research !== null ? { research: plan.research } : {}),
              ...(plan.ownerProfile !== null ? { ownerProfile: plan.ownerProfile } : {}),
              marketing: plan.marketing,
              identity: plan.identity,
              dropped: plan.dropped,
            },
            capabilityBoundary: buildCapabilityBoundary(listConnectedChannels(db, companyId)),
            env: buildAuthEnv(db),
          });
    const flagged = !verdict.feasible || !verdict.specific;
    const attempts = repo.getRevisionAttempts(companyId);
    const outcome = decideBusinessPlanOutcome({
      flagged,
      attempts,
      cap: BUSINESS_PLAN_REVISION_CAP,
    });
    if (outcome === "revise") {
      repo.bumpRevisionAttempts(companyId);
      // Leave the plan 'critiquing' — the CEO's resubmit supersedes it via
      // submit_business_plan's own prior-supersede logic. No card yet.
      deliverSystemMessage(plan.proposedByAgentId, formatBusinessPlanFeedback(verdict.feedback));
      return;
    }
    repo.clearRevisionAttempts(companyId);
    const note = flagged ? "⚠ Revisar — pode estar genérico ou inviável. " : "";
    repo.markProposed(businessPlanId);
    inbox.create({
      companyId,
      kind: "business_proposed",
      actorId: plan.proposedByAgentId,
      title: "Negócio proposto",
      preview: (note + plan.concept).slice(0, 200),
      requiresAction: true,
      payloadJson: JSON.stringify({ businessPlanId }),
    });
    broadcastInboxUpdate(companyId);
  };

  const handleGoalPlanProposed = async (goalId: string, planId: string): Promise<void> => {
    const goalsRepo = createGoalsRepository(db);
    const plansRepo = createGoalPlansRepository(db);
    const plan = plansRepo.getById(planId);
    const goal = goalsRepo.getById(goalId);
    if (plan === null || goal === null || plan.status !== "critiquing") return;
    const { vagueIssues, coverageGaps } = await critiqueGoalPlan(
      { db, runDerivation: (i) => runDerivation({ runProcess: defaultRunProcess }, i) },
      {
        goalTitle: goal.title,
        goalDescription: goal.description ?? "",
        issues: plan.issuesToCreate.map((i) => ({ title: i.title, description: i.description })),
        env: buildAuthEnv(db),
        companyId: goal.companyId,
      },
    );
    const attempts = goalPlanRevisions.get(goalId) ?? 0;
    // I-cov (audit 2026-06-03): coverage gaps (goal requirements no issue
    // delivers) count toward "needs revision" alongside vague issues — a plan
    // that misses part of the goal would otherwise sail through and the goal
    // could never be achieved.
    const outcome = decidePlanOutcome({
      flaggedCount: vagueIssues.length + coverageGaps.length,
      attempts,
      cap: GOAL_PLAN_REVISION_CAP,
    });
    if (outcome === "revise") {
      goalPlanRevisions.set(goalId, attempts + 1);
      const parts: string[] = [];
      if (vagueIssues.length > 0) {
        parts.push(
          "Some issues are too vague (no concrete deliverable / done-when):\n" +
            vagueIssues.map((v) => `- ${v.title}: ${v.feedback}`).join("\n"),
        );
      }
      if (coverageGaps.length > 0) {
        parts.push(
          "The plan does not fully cover the goal — add issues for:\n" +
            coverageGaps.map((g) => `- ${g}`).join("\n"),
        );
      }
      const feedback = parts.join("\n\n");
      // Re-engage the CEO via the existing goal-plan feedback loop. The goal is
      // still 'planning' and the plan stays 'critiquing' (hidden) until resubmit.
      deliverSystemMessage(plan.proposedByAgentId, formatGoalPlanRequest(goal, feedback));
      return;
    }
    goalPlanRevisions.delete(goalId);
    plansRepo.markProposed(planId);
    goalsRepo.updateStatus(goalId, "proposed");
    const note = vagueIssues.length > 0 ? "⚠ Revisar — algumas issues podem estar vagas. " : "";
    inbox.create({
      companyId: goal.companyId,
      kind: "goal_proposed",
      actorId: plan.proposedByAgentId,
      title: `Plano proposto para "${goal.title}"`,
      preview: (note + plan.summary).slice(0, 200),
      requiresAction: true,
      payloadJson: JSON.stringify({ goalId, planId }),
    });
    broadcastInboxUpdate(goal.companyId);
  };

  // Dispatch agent-emitted side-channel events (inter-agent delivery, hire/fire,
  // issue notifications). Called from the file-based events watcher; previously
  // ran inside the per-agent onStderr handler but stderr forwarding from the MCP
  // child through claude is unreliable on Windows.
  const dispatchAgentEvent = (event: AgentSideEvent): void => {
    const { kind, companyId, payload } = event;
    if (kind === "agent.deliver" && typeof payload === "object" && payload !== null) {
      const p = payload as {
        targetId: string;
        threadId: string;
        senderName: string;
        senderId: string | null;
        senderKind?: "user" | "agent";
        content: string;
      };
      const target = agents.getById(p.targetId);
      if (target === null) return;
      ensureAgentRunner(target);
      const sender: Sender = {
        kind: p.senderKind ?? "agent",
        id: p.senderId,
        name: p.senderName,
      };
      router.enqueue(p.targetId, p.threadId, p.content, sender, null);
    } else if (kind === "agent.kill" && typeof payload === "object" && payload !== null) {
      const p = payload as { agentId: string };
      const a = getAdapter(p.agentId);
      a?.kill();
      removeAdapter(p.agentId);
      broadcast({ kind: "roster-changed", companyId });
    } else if (kind === "agent.spawn-needed") {
      broadcast({ kind: "roster-changed", companyId });
    } else if (kind === "user.message-append" && typeof payload === "object" && payload !== null) {
      // report_to_user appended a message to the agent's user thread but
      // can't broadcast directly from the MCP child. Re-broadcast here so
      // the renderer's message-append listener appends it.
      const p = payload as { agentId: string; messageId: string };
      const row = db
        .prepare(
          `SELECT m.id, m.thread_id, m.sender_kind, m.sender_id, m.content,
                  m.kind, m.tool_calls_json, m.created_at,
                  t.participants_json AS participants_json
             FROM messages m
             JOIN threads t ON t.id = m.thread_id
            WHERE m.id = ?`,
        )
        .get(p.messageId) as
        | {
            id: string;
            thread_id: string;
            sender_kind: string;
            sender_id: string | null;
            content: string;
            kind: string;
            tool_calls_json: string | null;
            created_at: number;
            participants_json: string;
          }
        | undefined;
      if (row !== undefined) {
        broadcast({
          kind: "message-append",
          agentId: p.agentId,
          message: {
            id: row.id,
            threadId: row.thread_id,
            senderKind: row.sender_kind as "agent" | "user" | "system",
            senderId: row.sender_id,
            content: row.content,
            kind: row.kind as MessageKind,
            toolCalls:
              row.tool_calls_json === null
                ? null
                : (JSON.parse(row.tool_calls_json) as ToolCallView[]),
            createdAt: row.created_at,
            threadParticipants: row.participants_json.split("|"),
          },
        });
      }
    } else if (
      (kind === "issue.created" || kind === "issue.updated") &&
      typeof payload === "object" &&
      payload !== null
    ) {
      const p = payload as {
        issueId: string;
        statusChange?: { from: string; to: string; agentId: string };
      };
      const issueRow = db.prepare("SELECT company_id FROM issues WHERE id = ?").get(p.issueId) as
        | { company_id: string }
        | undefined;
      if (issueRow !== undefined) {
        broadcastIssueChanged({
          kind: kind === "issue.created" ? "created" : "updated",
          issueId: p.issueId,
          companyId: issueRow.company_id,
        });
        // C1 (audit 2026-06-03): the AGENT path (MCP update_issue) emits
        // issue.updated but — unlike the renderer IPC handler — never ran the
        // verification trigger / topo-unlock, so a goal whose last issue an
        // agent marked done was stranded `in_progress` forever. Run the SAME
        // shared reaction here and wake any unlocked dependents.
        const unlocked = reactToIssueChange(db, p.issueId, buildVerificationDeps());
        const recorder = tryGetRecorder();
        // C5 (audit 2026-06-03): the MCP child has no recorder, so an agent's
        // issue status change wrote no activity_events — the derivation/routines/
        // recall observers were blind to agent issue work. Re-record it in MAIN
        // (where the recorder is live) so issue_done lessons etc. actually fire.
        if (p.statusChange !== undefined) {
          recorder?.recordActivity({
            companyId: issueRow.company_id,
            actor: { kind: "agent", id: p.statusChange.agentId },
            action: "issue.status_changed",
            entityKind: "issue",
            entityId: p.issueId,
            agentId: p.statusChange.agentId,
            payload: { from: p.statusChange.from, to: p.statusChange.to },
          });
        }
        for (const dep of unlocked) {
          notifyAssignee(db, eventsDir, dep);
          recorder?.recordActivity({
            companyId: dep.companyId,
            actor: { kind: "system" },
            action: "issue.unlocked_by_deps",
            entityKind: "issue",
            entityId: dep.id,
            payload: { unlockedBy: p.issueId },
          });
        }
      }
    } else if (kind === "issue.assigned" && typeof payload === "object" && payload !== null) {
      // C6 (audit 2026-06-03): the MCP assign_issue tool can't call notifyAssignee
      // (no BrowserWindow in the child), so it emits this; MAIN wakes the assignee.
      const issue = createIssuesRepository(db).getById((payload as { issueId: string }).issueId);
      if (issue !== null) notifyAssignee(db, eventsDir, issue);
    } else if (
      kind === "approval.route" ||
      kind === "approval.decided" ||
      kind === "approval.escalate"
    ) {
      // CEO-side approval tools run in the MCP child (no engine bridge there);
      // they emit these events so MAIN does the routing/decision work.
      handleApprovalEvent({ kind, agentId: event.agentId, companyId, payload });
    } else if (kind === "x.post" && typeof payload === "object" && payload !== null) {
      // The post_to_x / reply_on_x tools self-gate in the MCP child, then emit this
      // once approved. Only MAIN holds the safeStorage cipher to decrypt the
      // company's X token, so the actual publish happens here; the result is written
      // back (keyed by postId) for the still-waiting tool to return to the agent.
      const p = payload as { postId: string; text: string; inReplyToId?: string };
      const permDir = getPermissionsDir(app.getPath("userData"));
      const repo = createConnectionsRepository(db, safeStorageCipher());
      void handleXPostEvent(
        {
          repo,
          http: httpFetch,
          writeResult: (postId, result) =>
            writeFileSync(join(permDir, `${postId}.xpost.json`), JSON.stringify(result)),
          now: () => Date.now(),
          onPosted: (tweetId, text) =>
            createXPostsRepository(db).record({
              companyId,
              tweetId,
              text,
              postedAt: Date.now(),
            }),
        },
        companyId,
        p,
      );
    } else if (kind === "stripe.setup" && typeof payload === "object" && payload !== null) {
      // setup_monetization / create_payment_link self-gate in the MCP child, then emit
      // this once approved. Only MAIN holds the safeStorage cipher to decrypt the
      // company's Stripe key, so the product/price/payment-link creation happens here;
      // the result is written back (keyed by requestId) for the waiting tool to return.
      const p = payload as { requestId: string; items: StripeChargeItem[] };
      const permDir = getPermissionsDir(app.getPath("userData"));
      const repo = createConnectionsRepository(db, safeStorageCipher());
      void handleStripeSetupEvent(
        {
          repo,
          http: httpFetch,
          writeResult: (requestId, result) =>
            writeFileSync(join(permDir, `${requestId}.stripe.json`), JSON.stringify(result)),
        },
        companyId,
        p,
      );
    } else if (kind === "cloudflare.deploy" && typeof payload === "object" && payload !== null) {
      // deploy_app (preview, or production after self-gate) emits this; only MAIN holds
      // the cipher to decrypt the Cloudflare token, so Wrangler runs here. On a production
      // deploy, persist the live URL into the connection metadata for deployment_status.
      const p = payload as {
        requestId: string;
        projectPath: string;
        projectName: string;
        mode: "preview" | "production";
      };
      const permDir = getPermissionsDir(app.getPath("userData"));
      const repo = createConnectionsRepository(db, safeStorageCipher());
      void handleCloudflareDeployEvent(
        {
          repo,
          runWrangler: defaultWranglerRunner,
          writeResult: (requestId, result) =>
            writeFileSync(join(permDir, `${requestId}.deploy.json`), JSON.stringify(result)),
          onProductionUrl: (url) => {
            const conn = repo.load(companyId, "cloudflare");
            if (conn !== null) {
              repo.save(companyId, "cloudflare", conn.payload, {
                ...conn.metadata,
                lastDeployUrl: url,
              });
            }
          },
        },
        companyId,
        p,
      );
    } else if (kind === "cloudflare.d1" && typeof payload === "object" && payload !== null) {
      // provision_database self-gates in the MCP child, then emits this once approved.
      // MAIN decrypts the token and runs the constrained `wrangler d1` command.
      const p = payload as {
        requestId: string;
        projectPath: string;
        databaseName: string;
        command: "create" | "migrate";
      };
      const permDir = getPermissionsDir(app.getPath("userData"));
      const repo = createConnectionsRepository(db, safeStorageCipher());
      void handleCloudflareD1Event(
        {
          repo,
          runWrangler: defaultWranglerRunner,
          writeResult: (requestId, result) =>
            writeFileSync(join(permDir, `${requestId}.d1.json`), JSON.stringify(result)),
        },
        companyId,
        p,
      );
    } else if (kind === "email.send" && typeof payload === "object" && payload !== null) {
      // send_email self-gates in the MCP child, then emits this once approved. Only MAIN
      // holds the cipher to decrypt the mailbox credentials, so the SMTP/Resend send runs here.
      const p = payload as {
        requestId: string;
        to: string | string[];
        subject: string;
        body: string;
        inReplyTo?: string;
      };
      const permDir = getPermissionsDir(app.getPath("userData"));
      const repo = createConnectionsRepository(db, safeStorageCipher());
      void handleEmailSendEvent(
        {
          repo,
          emailDeps: {
            http: httpFetch,
            smtpSend: defaultSmtpSend,
            smtpVerify: defaultSmtpVerify,
            imapFetch: defaultImapFetch,
          },
          writeResult: (requestId, result) =>
            writeFileSync(join(permDir, `${requestId}.email.json`), JSON.stringify(result)),
        },
        companyId,
        p,
      );
    } else if (kind === "email.read" && typeof payload === "object" && payload !== null) {
      const p = payload as { requestId: string; limit?: number };
      const permDir = getPermissionsDir(app.getPath("userData"));
      const repo = createConnectionsRepository(db, safeStorageCipher());
      void handleEmailReadEvent(
        {
          repo,
          emailDeps: {
            http: httpFetch,
            smtpSend: defaultSmtpSend,
            smtpVerify: defaultSmtpVerify,
            imapFetch: defaultImapFetch,
          },
          writeResult: (requestId, result) =>
            writeFileSync(join(permDir, `${requestId}.email.json`), JSON.stringify(result)),
          db,
        },
        companyId,
        p,
      );
    } else if (kind === "org.proposed" && typeof payload === "object" && payload !== null) {
      const p = payload as { orgPlanId: string };
      void handleOrgProposed(p.orgPlanId, companyId);
    } else if (
      kind === "business_plan.proposed" &&
      typeof payload === "object" &&
      payload !== null
    ) {
      const p = payload as { businessPlanId: string };
      void handleBusinessPlanProposed(p.businessPlanId, companyId);
    } else if (kind === "goal.plan_proposed" && typeof payload === "object" && payload !== null) {
      const p = payload as { goalId: string; planId: string };
      void handleGoalPlanProposed(p.goalId, p.planId);
    }
  };

  const eventsDir = getEventsDir(app.getPath("userData"));
  void startEventsWatcher({ dir: eventsDir, onEvent: dispatchAgentEvent });

  // P3 Senses: daily X analytics ingestion. System-side (no agent turn). Fail-soft
  // per company; reuses the auto-refreshing token manager. 30-day post window.
  const X_METRICS_INTERVAL_MS = 24 * 60 * 60_000;
  const X_POST_WINDOW_MS = 30 * 24 * 60 * 60_000;
  const stopXMetricsPoller = startXMetricsPoller({
    intervalMs: X_METRICS_INTERVAL_MS,
    run: () => {
      const cipher = safeStorageCipher();
      const connections = createConnectionsRepository(db, cipher);
      const posts = createXPostsRepository(db);
      const metrics = createXMetricsRepository(db);
      return collectXMetrics({
        listCompaniesWithX: () =>
          (
            db
              .prepare("SELECT DISTINCT company_id FROM connections WHERE kind = 'x'")
              .all() as Array<{
              company_id: string;
            }>
          ).map((r) => r.company_id),
        getToken: (companyId) =>
          getValidXAccessToken(connections, httpFetch, companyId, () => Date.now()),
        getUserMetrics: (token) => getUserMetrics(httpFetch, token),
        recentPosts: (companyId) => posts.recentByCompany(companyId, Date.now() - X_POST_WINDOW_MS),
        getTweetMetrics: (token, ids) => getTweetMetrics(httpFetch, token, ids),
        insertAccount: (i) => metrics.insertAccount(i),
        insertTweet: (i) => metrics.insertTweet(i),
        now: () => Date.now(),
      });
    },
  });
  void stopXMetricsPoller; // held for symmetry; process-lifetime poller

  // P3 Self-adjust: weekly growth review. When follower growth stalls, nudge the
  // CEO to revise the content strategy (posts still go through the gate). De-dup
  // in-memory: at most one nudge per company per week.
  const X_GROWTH_REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60_000;
  const xGrowthLastNudged = new Map<string, number>();
  const stopXGrowthReview = startXMetricsPoller({
    intervalMs: X_GROWTH_REVIEW_INTERVAL_MS,
    run: () => {
      const metrics = createXMetricsRepository(db);
      reviewXGrowth({
        listCompaniesWithX: () =>
          (
            db
              .prepare("SELECT DISTINCT company_id FROM connections WHERE kind = 'x'")
              .all() as Array<{
              company_id: string;
            }>
          ).map((r) => r.company_id),
        accountSeries: (companyId, sinceMs) => metrics.accountSeries(companyId, sinceMs),
        windowMs: X_GROWTH_REVIEW_INTERVAL_MS,
        now: () => Date.now(),
        shouldNudge: (companyId) =>
          Date.now() - (xGrowthLastNudged.get(companyId) ?? 0) >= X_GROWTH_REVIEW_INTERVAL_MS,
        onStagnant: (companyId, summary) => {
          const ceo = findActiveCeo(agents.listByCompany(companyId));
          if (ceo === null) return;
          deliverSystemMessage(
            ceo.id,
            `[X_GROWTH] Crescimento no X precisa de atenção: ${summary}. ` +
              `Reavalie a estratégia de conteúdo — use x_insights_read para ver o que funcionou — ` +
              `e proponha ajustes. Novos posts passam pela aprovação normal.`,
          );
          inbox.create({
            companyId,
            kind: "suggestion",
            actorId: ceo.id,
            title: "Crescimento no X estagnou",
            preview: summary,
            requiresAction: false,
            payloadJson: JSON.stringify({ kind: "x_growth_review", summary }),
          });
          broadcastInboxUpdate(companyId);
          xGrowthLastNudged.set(companyId, Date.now());
        },
      });
      return Promise.resolve();
    },
  });
  void stopXGrowthReview; // process-lifetime poller (mirrors the metrics poller)

  // P5.3 Senses (money): daily Stripe sales ingestion. System-side (no agent turn),
  // fail-soft per company. The FIRST real payment surfaces as a celebratory inbox
  // card (the R$10 proof made visible) + a nudge to the CEO. No webhook — a desktop
  // app can't receive Stripe webhooks reliably, so this polls (the P3 senses pattern).
  const STRIPE_SALES_INTERVAL_MS = 24 * 60 * 60_000;
  const STRIPE_SALES_WINDOW_MS = 90 * 24 * 60 * 60_000;
  const stopStripeSalesPoller = startXMetricsPoller({
    intervalMs: STRIPE_SALES_INTERVAL_MS,
    run: () => {
      const connections = createConnectionsRepository(db, safeStorageCipher());
      const payments = createStripePaymentsRepository(db);
      return collectStripeSales({
        listCompaniesWithStripe: () =>
          (
            db
              .prepare("SELECT DISTINCT company_id FROM connections WHERE kind = 'stripe'")
              .all() as Array<{ company_id: string }>
          ).map((r) => r.company_id),
        getKey: (companyId) => {
          const conn = connections.load(companyId, "stripe");
          return conn !== null && typeof conn.payload.restrictedKey === "string"
            ? conn.payload.restrictedKey
            : null;
        },
        listCharges: (key, sinceMs) => listCharges(httpFetch, key, { createdGte: sinceMs }),
        countExisting: (companyId) => payments.countByCompany(companyId),
        record: (i) => payments.record(i),
        onFirstSale: (companyId, charge) => {
          const label = `${charge.currency.toUpperCase()} ${(charge.amount / 100).toFixed(2)}`;
          const ceo = findActiveCeo(agents.listByCompany(companyId));
          inbox.create({
            companyId,
            kind: "sale",
            actorId: ceo?.id ?? null,
            title: "Primeira venda!",
            preview: `Seu negócio recebeu o primeiro pagamento (${label}). O loop fechou.`,
            requiresAction: false,
            payloadJson: JSON.stringify({
              kind: "first_sale",
              amount: charge.amount,
              currency: charge.currency,
            }),
          });
          broadcastInboxUpdate(companyId);
          if (ceo !== null) {
            deliverSystemMessage(
              ceo.id,
              `[VENDA] O negócio recebeu a primeira venda real (${label}). ` +
                `Continue o trabalho de crescimento — novas cobranças seguem passando pela aprovação.`,
            );
          }
        },
        windowMs: STRIPE_SALES_WINDOW_MS,
        now: () => Date.now(),
      });
    },
  });
  void stopStripeSalesPoller; // process-lifetime poller

  // "Steal" #3: weekly finance review. When the business spends without earning, nudge the
  // CEO (inform only — no pause; hard budget caps live in enforce-budget). De-dup weekly.
  const FINANCE_INTERVAL_MS = 7 * 24 * 60 * 60_000;
  const financeLastNudged = new Map<string, number>();
  const stopFinanceReview = startXMetricsPoller({
    intervalMs: FINANCE_INTERVAL_MS,
    run: () => {
      const costs = createCostsRepository(db);
      const payments = createStripePaymentsRepository(db);
      reviewFinance({
        listCompanies: () =>
          (
            db.prepare("SELECT DISTINCT company_id FROM cost_events").all() as Array<{
              company_id: string;
            }>
          ).map((r) => r.company_id),
        windowCostCents: (companyId, sinceMs) =>
          costs.getCompanyTotalSince(companyId, sinceMs).cents,
        windowRevenue: (companyId, sinceMs) => {
          const byCurrency: Record<string, number> = {};
          let totalCents = 0;
          for (const p of payments.listByCompany(companyId, sinceMs)) {
            byCurrency[p.currency] = (byCurrency[p.currency] ?? 0) + p.amount;
            totalCents += p.amount;
          }
          return { totalCents, byCurrency };
        },
        windowMs: FINANCE_INTERVAL_MS,
        thresholdCents: 100,
        now: () => Date.now(),
        shouldNudge: (companyId) =>
          Date.now() - (financeLastNudged.get(companyId) ?? 0) >= FINANCE_INTERVAL_MS,
        onLoss: (companyId, summary) => {
          const ceo = findActiveCeo(agents.listByCompany(companyId));
          if (ceo === null) return;
          deliverSystemMessage(
            ceo.id,
            `[FINANCE] Atenção às finanças: ${summary}. Foque em receita — proponha/ajuste a ` +
              `monetização e o que vai ao ar. (Aviso, não bloqueio.)`,
          );
          inbox.create({
            companyId,
            kind: "suggestion",
            actorId: ceo.id,
            title: "Gastando sem faturar",
            preview: summary,
            requiresAction: false,
            payloadJson: JSON.stringify({ kind: "finance_loss", summary }),
          });
          broadcastInboxUpdate(companyId);
          financeLastNudged.set(companyId, Date.now());
        },
      });
      return Promise.resolve();
    },
  });
  void stopFinanceReview; // process-lifetime poller

  // Serializes compaction per project (same-agent overlap AND two agents on one
  // project): the digest write is a non-atomic read-modify-write and a redundant
  // distill costs real money. Key = `${companyId}:${projectId}`.
  const compactionInFlight = new Set<string>();
  const lastCompactedAt = new Map<string, number>();
  const COMPACTION_COOLDOWN_MS = 10 * 60_000; // 10 min between compactions per project

  // Memória de Contexto de Projeto (Fase 1): after an idle turn, if the session
  // re-read more cached context than the threshold, distill the session into a
  // digest (folding durable knowledge), then RESET the agent's session (clear
  // session id + kill/drop the adapter + seed). No live message is delivered —
  // the agent is idle, so the next real message re-spawns it fresh (no --resume)
  // with the now-richer context block injected. Safe: never kills a mid-turn
  // process.
  //
  // The session RESET is the real cost lever (caps cache_read growth). It applies
  // to EVERY agent over threshold + idle — including the CEO, whose normal scope
  // is allowedProjects=[] (= all projects). The digest FOLD target depends on
  // scope: a single-project agent folds into that PROJECT's digest (verifiable
  // against the repo); the CEO / multi-project agent has no single repo root, so
  // it folds into an AGENT-scoped digest (knowledge not pinned to source files).
  const maybeCompactAfterTurn = async (agent: Agent, cacheRead: number): Promise<void> => {
    try {
      const threshold = settingsRepo.read().compactionCacheReadThreshold;
      if (!shouldCompact({ cacheRead }, threshold)) return;

      const live = agents.getById(agent.id);
      if (live === null || live.status === "paused" || live.status === "terminated") return;

      const target = compactionTarget(agent);
      // For a single-project agent, resolve the project so the digest folds against
      // the live repo (provenance hashing + the project digest_path marker). For an
      // agent-scoped target there is no single repo root.
      const proj =
        target.kind === "project" ? createProjectsRepository(db).getById(target.projectId) : null;
      // A single-project agent whose project row is gone has nowhere to fold —
      // skip (mirrors the old behaviour where proj===null returned early).
      if (target.kind === "project" && proj === null) return;

      const userDataDir = app.getPath("userData");
      const digestPath =
        target.kind === "project"
          ? projectDigestPath(userDataDir, agent.companyId, target.projectId)
          : agentDigestPath(userDataDir, agent.companyId, target.agentId);

      // Serialize per target: project compactions key on the project (two agents
      // on one project must not race the read-modify-write); agent-scoped ones key
      // on the agent.
      const compactionKey =
        target.kind === "project"
          ? `${agent.companyId}:${target.projectId}`
          : `${agent.companyId}:agent:${target.agentId}`;
      if (compactionInFlight.has(compactionKey)) return; // a compaction for this target is already running
      const last = lastCompactedAt.get(compactionKey) ?? 0;
      if (Date.now() - last < COMPACTION_COOLDOWN_MS) return;
      compactionInFlight.add(compactionKey);
      try {
        const trail = buildRecoveryTrail(db, agent.id, 200);
        if (trail === null || trail.messages.length === 0) return;
        const transcript = trail.messages.map((m) => `${m.sender}: ${m.content}`).join("\n");

        const worker = createCompactionWorker({
          runDistill: ({ prompt, model }) =>
            runDerivation(
              { runProcess: defaultRunProcess },
              { prompt, model, env: buildAuthEnv(db) },
            ),
          // Provenance hashing only makes sense against a single repo root. For an
          // agent-scoped digest there is none, so source files stay unhashed (the
          // freshness pass treats them as unverifiable, which is correct).
          hashSources: (files) =>
            proj !== null
              ? hashSources(files, (rel) => readFileSync(join(proj.path, rel), "utf8"))
              : "",
          newId: () => `dig_${randomUUID()}`,
          now: () => Date.now(),
          onCost: (usage, model) =>
            costsRepo.insert({
              companyId: agent.companyId,
              agentId: agent.id,
              projectId: proj?.id ?? null,
              issueId: null,
              adapterName: "compaction",
              model,
              sessionId: null,
              inputTokens: usage.input,
              outputTokens: usage.output,
              cacheCreationTokens: usage.cacheCreation,
              cacheReadTokens: usage.cacheRead,
              costCentsEstimate: estimateCostCents(model, {
                input: usage.input,
                output: usage.output,
                cache_creation: usage.cacheCreation,
                cache_read: usage.cacheRead,
              }),
              occurredAt: Date.now(),
            }),
        });

        const { taskState, distillKind } = await worker.compact({
          companyId: agent.companyId,
          agentId: agent.id,
          transcript,
          digestPath,
        });

        // Always set the cooldown, regardless of whether the distill succeeded
        // or was discarded. A failed/discarded distill must still back off so
        // we don't retry on every subsequent turn (retry storm).
        lastCompactedAt.set(compactionKey, Date.now());

        // The project digest_path marker is project-only (agent digests are
        // resolved purely from companyId + agentId, no DB row).
        if (proj !== null && shouldResetSession(distillKind)) {
          createProjectsRepository(db).setDigestPath(
            proj.id,
            relativeDigestPath(agent.companyId, proj.id),
          );
        }

        // Re-check after the async distill: only reset if STILL idle and live,
        // AND only when the distill produced a valid digest (distillKind="ok").
        // A discarded distill means no new digest was written — resetting the
        // session would throw away live context for nothing.
        if (!shouldResetSession(distillKind)) return;
        const live2 = agents.getById(agent.id);
        if (live2 === null || live2.status === "paused" || live2.status === "terminated") return;
        if (router.getCurrentThread(agent.id) !== null) return; // became busy again
        agents.clearSessionId(agent.id);
        const adapter = getAdapter(agent.id);
        if (adapter !== undefined) {
          adapter.kill();
          removeAdapter(agent.id);
        }
        if (taskState.trim() !== "") {
          router.setPendingSeed(
            agent.id,
            `[CONTEXT COMPACTED] Where you left off:\n\n${taskState}`,
          );
        }
      } finally {
        compactionInFlight.delete(compactionKey);
      }
    } catch (err) {
      console.warn(`[compaction] agent ${agent.id} failed: ${String(err)}`);
    }
  };

  // Count of live adapters that belong to NON-CEO (worker) agents. Used to
  // reserve one management lane for the CEO (see ensureAgentRunner cap below).
  const liveWorkerCount = (): number =>
    listAdapterAgentIds().filter((id) => {
      if (getAdapter(id)?.isAlive() !== true) return false;
      const a = agents.getById(id);
      return a !== null && !isCeoAgent(a);
    }).length;

  // Per-agent error path for a failed spawn (ensureAdapter rejected). Mirrors
  // the original `onError` closure that was inline in ensureAgentRunner — same
  // bookkeeping (recovery tracker, status, broadcasts), no behavior change.
  const handleSpawnError = (agentId: string, err: Error): void => {
    recoveryTracker.markErrored(agentId);
    console.error(`[claude:${agentId}] spawn error: ${err.message}`);
    olog(`spawn error agent=${agentId}: ${err.message}`);
    removeAdapter(agentId);
    agents.clearSessionId(agentId);
    agents.updateStatus(agentId, { status: "error", currentAction: null });
    broadcast({ kind: "error", agentId, message: err.message });
    broadcast({
      kind: "status-changed",
      agentId,
      status: "error",
      updatedAt: Date.now(),
    });
    currentActionDebouncer.cancel(agentId);
    broadcast({ kind: "current-action-changed", agentId, action: null });
  };

  // Build the adapter callbacks for one spawn. Called by createRespawnFn once
  // per respawn so each spawn gets its own `collectedToolCalls`, AND its own
  // `spawnState` cell allocated by createRespawnFn (per-spawn isolation: a
  // later spawn for the same agent gets a fresh cell, so this closure's
  // `spawnState.adapter` keeps pointing at THIS spawn's adapter). The cell
  // is populated by createRespawnFn AFTER ensureAdapter resolves but BEFORE
  // any callback can fire — equivalent to the original eager
  // `.then(a => thisSpawn = a)` capture, no race.
  //
  // Closures over outer orchestrator state (broadcast, router, agents repo,
  // debouncer, etc.) so the recovery module gets the same event-handling
  // behavior as the IPC path.
  const buildCallbacks = (agentId: string, spawnState: SpawnState): AdapterCallbacks => {
    const agent = agents.getById(agentId);
    if (agent === null) {
      throw new Error(`Agent ${agentId} not found when building callbacks`);
    }
    const collectedToolCalls = new Map<string, ToolCallView>();

    return {
      onEvent: (ev: ParsedEvent) => {
        if (ev.kind === "session-init") {
          agents.setSessionId(agent.id, ev.sessionId);
          nudgeTracker.clear(agent.id);
          broadcast({
            kind: "session-id-changed",
            agentId: agent.id,
            sessionId: ev.sessionId,
          });
          agents.updateStatus(agent.id, { status: "thinking", currentAction: null });
          broadcast({
            kind: "status-changed",
            agentId: agent.id,
            status: "thinking",
            updatedAt: Date.now(),
          });
          currentActionDebouncer.schedule(agent.id, null);
        } else if (ev.kind === "assistant-message") {
          let textContent = "";
          const tools: ToolCallView[] = [];
          for (const block of ev.blocks) {
            if (block.kind === "text") {
              textContent += block.text;
            } else {
              const tc: ToolCallView = {
                id: block.id,
                name: block.name,
                input: block.input,
                status: "pending",
                result: null,
              };
              tools.push(tc);
              collectedToolCalls.set(block.id, tc);
              const actionText = mapToolUseToAction(block.name, block.input);
              agents.updateStatus(agent.id, {
                status: "working",
                currentAction: actionText,
              });
              broadcast({
                kind: "status-changed",
                agentId: agent.id,
                status: "working",
                updatedAt: Date.now(),
              });
              currentActionDebouncer.schedule(agent.id, actionText);
            }
          }
          const threadId = router.getCurrentThread(agent.id);
          if (threadId !== null && (textContent !== "" || tools.length > 0)) {
            const m = messages.appendToThreadId({
              threadId,
              senderKind: "agent",
              senderId: agent.id,
              content: textContent,
              toolCalls: tools.length > 0 ? tools : null,
            });
            const threadParticipants = messages.getThreadParticipants(threadId) ?? undefined;
            broadcast({
              kind: "message-append",
              agentId: agent.id,
              message: { ...m, ...(threadParticipants ? { threadParticipants } : {}) },
            });
          }
        } else if (ev.kind === "tool-result") {
          const existing = collectedToolCalls.get(ev.toolUseId);
          if (existing !== undefined) {
            existing.status = ev.isError ? "error" : "success";
            existing.result = ev.content;
            broadcast({
              kind: "tool-result",
              agentId: agent.id,
              threadId: router.getCurrentThread(agent.id) ?? "",
              toolCallId: ev.toolUseId,
              result: ev.content,
            });
          }
        } else if (ev.kind === "turn-complete") {
          // Token-recovery v0.1.17: guard against a stale turn-complete from
          // a previous (killed) spawn clearing a fresh pending turn after a
          // recovery-driven respawn. `onExit` already does this via the
          // spawn-identity check (see comment there); mirror it here so a
          // late turn-complete from the dead adapter is a complete no-op.
          if (spawnState.adapter !== null && getAdapter(agent.id) !== spawnState.adapter) {
            return;
          }
          // Token-recovery v0.1.17: the agent answered the user's message, so
          // there's nothing pending to re-emit on a future respawn. Safe no-op
          // if no entry (e.g. an internal recovery turn with no user input).
          pendingTurnByAgent.delete(agent.id);
          // M8: persist usage + enforce budget + lazy day-summary roll-up.
          // Note: per-issue enforcement requires router.getCurrentIssue
          // which doesn't exist v1; falls back to null (daily cap still
          // works). M8.5 will add issue tracking to router.
          if (ev.usage !== undefined) {
            const projectIds = agent.allowedProjects;
            const projectId = projectIds.length === 1 ? projectIds[0]! : null;
            costRecorder.recordTurn({
              companyId: agent.companyId,
              agentId: agent.id,
              projectId,
              issueId: null,
              adapterName: agent.adapterName,
              model: ev.model ?? agent.model,
              sessionId: agent.claudeSessionId,
              usage: ev.usage,
            });
            checkAndPause(enforceDeps, {
              companyId: agent.companyId,
              agentId: agent.id,
              issueId: null,
            });
            const activityRec = tryGetRecorder();
            if (activityRec !== undefined) {
              rollUpYesterdayIfNeeded({
                db,
                now: () => Date.now(),
                companyId: agent.companyId,
                agentId: agent.id,
                costsRepo,
                activityRecorder: activityRec,
              });
            }
          }
          const toolUseCount = collectedToolCalls.size;
          const readSkill = [...collectedToolCalls.values()].some((tc) =>
            tc.name.endsWith("skill_read"),
          );
          collectedToolCalls.clear();
          router.onTurnComplete(agent.id);
          const memoryNearFull = agentMemoryNearFull(createMemoriesRepository(db), agent.id);
          const nudge = nudgeTracker.recordTurn(agent.id, {
            toolUseCount,
            memoryNearFull,
            readSkill,
          });
          if (nudge !== null) router.setPendingNudge(agent.id, nudge);
          const stillBusy = router.getCurrentThread(agent.id) !== null;
          // Respect a status the budget enforcer (checkAndPause, above) or a
          // concurrent pause/terminate just set — do not clobber it back to
          // thinking/idle, which would un-pause the agent and let it keep
          // spending.
          const live = agents.getById(agent.id);
          if (live === null || (live.status !== "paused" && live.status !== "terminated")) {
            const status = stillBusy ? "thinking" : "idle";
            agents.updateStatus(agent.id, { status, currentAction: null });
            broadcast({
              kind: "status-changed",
              agentId: agent.id,
              status,
              updatedAt: Date.now(),
            });
          }
          currentActionDebouncer.flush(agent.id);
          currentActionDebouncer.schedule(agent.id, null);
          // Refresh agents roster on every turn-complete. Covers the case where this
          // turn called hire_agent/fire_agent and the renderer needs to see the new
          // sidebar state. stderr-based agent.spawn-needed events don't always reach
          // us through claude's stdio pipes on Windows, so this is the reliable path.
          broadcast({ kind: "roster-changed", companyId: agent.companyId });
          if (recoveryTracker.consumeRecovery(agent.id)) {
            tryGetRecorder()?.recordActivity({
              companyId: agent.companyId,
              actor: { kind: "system" },
              action: "agent.recovered",
              entityKind: "agent",
              entityId: agent.id,
              agentId: agent.id,
              payload: {},
            });
          }
          // Idle-only compaction (Phase 1): only when this turn left the agent
          // idle (no queued thread) — never kill a mid-turn process.
          if (ev.usage !== undefined && !stillBusy) {
            void maybeCompactAfterTurn(agent, ev.usage.cache_read ?? 0);
          }
          // A completed turn may have freed a slot (agent now idle) or the
          // agent had queued work for another agent — wake the drain.
          drainScheduler();
        } else if (ev.kind === "api-retry") {
          broadcast({
            kind: "error",
            agentId: agent.id,
            message: `API retry attempt ${String(ev.attempt)}: ${ev.error}`,
          });
        } else if (ev.kind === "rate-limited") {
          const until = ev.resetsAt ?? Date.now() + 60 * 60_000; // fallback 1h if no resetsAt
          const prev = settingsRepo.read().rateLimitedUntil;
          const wasGated = prev !== null && Date.now() < prev; // already parked in an active window?
          // Extend (never shrink) the window — a later event may push the reset out.
          settingsRepo.write({ rateLimitedUntil: Math.max(until, prev ?? 0) });
          // Account-wide limit → park every running agent. Reason "rate_limited"
          // marks them for auto-resume (distinct from a manual/budget pause).
          for (const id of listAdapterAgentIds()) {
            // Skip terminated agents — pausing would overwrite their authoritative
            // 'terminated' status with 'paused', producing a zombie that later
            // filters mistake for live. A terminated agent holds no real work.
            if (agents.getById(id)?.terminatedAt != null) continue;
            pauseAndStopAgent(id, "rate_limited", {
              getAdapter,
              removeAdapter,
              pause: (aid, reason) => agents.pause(aid, reason),
            });
            broadcast({
              kind: "status-changed",
              agentId: id,
              status: "paused",
              updatedAt: Date.now(),
            });
          }
          if (!wasGated) {
            const when = new Date(until).toLocaleString();
            inbox.create({
              companyId: agent.companyId,
              kind: "security_alert",
              actorId: agent.id,
              title: "Equipe pausada — limite do plano Max",
              preview: `A cota do Max foi atingida. A equipe retoma sozinha por volta de ${when}.`,
              requiresAction: false,
              payloadJson: null,
            });
            broadcastInboxUpdate(agent.companyId);
          }
        }
      },
      onStderr: (line: string) => {
        // Agent-emitted side-channel events now flow via file-based watcher
        // (see startEventsWatcher above). Stderr is only used for diagnostic
        // text from claude itself; log it.
        console.error(`[claude:${agent.id}] stderr: ${redactString(line)}`);
      },
      onExit: (code) => {
        console.error(`[claude:${agent.id}] exit code: ${String(code)}`);
        // Guard: if the adapter was already removed from the lifecycle Map
        // before this exit arrived (e.g. restartIfRunning for a mode/model
        // change, AGENT_KILL, or AGENTS_TERMINATE), this is a stale exit
        // from a process we intentionally killed. Do NOT overwrite the
        // status that was deliberately set, and do NOT corrupt the recovery
        // tracker by marking an intentional kill as an error.
        //
        // `spawnState.adapter` is set eagerly by createRespawnFn right after
        // ensureAdapter resolves — BEFORE any callback can fire — so it
        // always refers to THIS spawn's adapter, never a successor. A later
        // spawn allocates its OWN spawnState cell, so this closure's view of
        // `spawnState.adapter` is unaffected by the next spawn (per-spawn
        // isolation; mirrors the original `.then(a => thisSpawn = a)` pattern).
        const thisSpawn = spawnState.adapter;
        const isCurrent = thisSpawn !== null && getAdapter(agent.id) === thisSpawn;
        // Bail BEFORE removeAdapter. A stale exit means a NEWER adapter (from
        // restartIfRunning's resume re-spawn on a model/config change) — or
        // nothing — now owns this agentId. Calling removeAdapter here would
        // orphan that fresh adapter (the "agent dies on model change" bug).
        // Only the CURRENT adapter's own exit should clean the Map.
        if (!isCurrent) return;
        removeAdapter(agent.id);
        if (code !== 0) {
          recoveryTracker.markErrored(agent.id);
          agents.clearSessionId(agent.id);
          olog(`agent=${agent.id} → error on exit code=${String(code)}`);
        } else {
          autoHealAttempts.delete(agent.id); // clean exit resets the auto-heal budget
        }
        // Respect a status a concurrent budget-pause or terminate just set: a
        // process exit (esp. a clean code-0 exit right after a budget pause)
        // must not flip the agent back to idle and let it respawn + keep
        // spending. Mirrors the turn-complete guard. Audit 2026-06-03 Facet 1 I4.
        if (mayOverwriteStatusOnLifecycleEvent(agents.getById(agent.id))) {
          agents.updateStatus(agent.id, {
            status: code === 0 ? "idle" : "error",
            currentAction: null,
          });
          broadcast({
            kind: "status-changed",
            agentId: agent.id,
            status: code === 0 ? "idle" : "error",
            updatedAt: Date.now(),
          });
        }
        currentActionDebouncer.cancel(agent.id);
        broadcast({ kind: "current-action-changed", agentId: agent.id, action: null });
        // A slot just freed — wake the drain so waiting agents can spawn.
        drainScheduler();
      },
    };
  };

  // Encapsulates the SpawnContext construction (memory/telos/project-context
  // blocks, credentials, paths) + the ensureAdapter call. Used by the spawn
  // path below and reused by the auth-token-recovery module (token-recovery
  // v0.1.17) so a refreshed OAuth token can re-spawn an agent with the same
  // event-handling behavior.
  const respawnAgent = createRespawnFn({
    db,
    eventsDir,
    buildCallbacks,
    pendingTurnByAgent,
    writeStdin: writeStdinFn,
  });

  // Token-recovery v0.1.17: wire the recovery pipeline's runtime deps. The
  // recovery module is kept free of `electron` and orchestrator imports so it
  // stays unit-testable; injection happens here, once, at orchestrator init.
  setRespawnFn(respawnAgent);
  setUserDataDir(app.getPath("userData"));
  // Forward recovery-status broadcasts to every renderer via the dedicated
  // IPC.AUTH_RECOVERY_STATUS channel (separate from AGENT_EVENT so the
  // banner subscriber doesn't need to filter the agent-event firehose).
  setRecoveryBroadcastFn((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.AUTH_RECOVERY_STATUS, event);
    }
  });
  // Circuit breaker: when auto-recovery gives up (repeated 401s respawning can't
  // fix), pause + stop the agent so it stops thrashing. The circuit-open
  // broadcast above drives the reconnect banner; pausing the row + killing the
  // adapter stops the loop until the user reconnects.
  setRecoveryPauseFn((agentId, reason) => {
    pauseAndStopAgent(agentId, reason, {
      getAdapter,
      removeAdapter,
      pause: (id, r) => agents.pause(id, r),
    });
    const a = agents.getById(agentId);
    if (a !== null) {
      broadcast({ kind: "status-changed", agentId, status: "paused", updatedAt: Date.now() });
      inbox.create({
        companyId: a.companyId,
        kind: "security_alert",
        actorId: agentId,
        title: "Reconexão necessária",
        preview: `${a.name} foi pausado: a autenticação falhou repetidamente. Reconecte sua conta para retomar.`,
        requiresAction: true,
        payloadJson: JSON.stringify({ reason: "auth-unrecoverable", agentId }),
      });
      broadcastInboxUpdate(a.companyId);
    }
  });

  // Agents with a spawn currently in flight. `respawnAgent` is async (100-500ms);
  // without this guard a 2nd ensureAgentRunner call in that window (e.g. a drain
  // tick and a message arriving on the same tick) would start a SECOND `claude`
  // process for the same agent — the first becomes an orphan burning tokens with
  // no cleanup. Cleared in `.finally` below. Audit 2026-06-03 Facet 1 C1.
  const spawning = new Set<string>();
  const ensureAgentRunner = (agent: Agent): void => {
    const existing = getAdapter(agent.id);
    if (existing !== undefined && existing.isAlive()) return;

    // Never spawn a terminated agent. `terminatedAt` is the authoritative kill
    // marker; a zombie row whose status was reset to 'idle' must stay dead.
    if (agent.terminatedAt !== null) return;

    // A spawn for this agent is already in flight — bail (see `spawning` above).
    if (spawning.has(agent.id)) return;

    // Account-wide Max rate limit in effect → don't spawn; the team auto-resumes
    // when the window resets (handled in drainScheduler).
    const rlUntil = settingsRepo.read().rateLimitedUntil;
    if (rlUntil !== null && Date.now() < rlUntil) return;

    // Concurrency cap with a reserved management lane. The hard total (Max ToS)
    // is MAX_CONCURRENT_AGENTS; workers fill at most MAX-1 so the CEO can always
    // claim the last slot to decide approvals. Without the reservation,
    // approval-blocked workers hold every slot the CEO needs to unblock them
    // (priority-inversion deadlock). At the cap we just return — the router
    // holds the message and the drain scheduler picks it up when a slot frees.
    if (activeAdapterCount() >= MAX_CONCURRENT_AGENTS) return;
    if (!isCeoAgent(agent) && liveWorkerCount() >= MAX_CONCURRENT_AGENTS - 1) return;

    spawning.add(agent.id);
    void respawnAgent(agent.id)
      .then(() => {
        // Eager per-spawn `thisSpawn` capture happens inside createRespawnFn
        // (spawnState.adapter is set right after ensureAdapter resolves,
        // before any callback can fire). Here we just deliver any message
        // that was held in the router queue while the adapter was being
        // spawned (e.g. enqueue called before isAlive).
        router.deliverQueued(agent.id);
      })
      .catch((err: Error) => handleSpawnError(agent.id, err))
      .finally(() => spawning.delete(agent.id));
  };

  // Continuous drain: keeps the ≤MAX_CONCURRENT_AGENTS slots filled whenever
  // an agent has pending work but no live adapter. Called on turn-complete,
  // onExit, and a periodic 8-second tick so the org is always in motion.
  // ── v0.1.37 slot reclaim (clean-cancel) ──────────────────────────────────
  const permDir = getPermissionsDir(app.getPath("userData"));
  const safeUnlinkFile = (p: string): void => {
    try {
      unlinkSync(p);
    } catch {
      /* best-effort */
    }
  };

  // Reclaim a parked (approval-blocked) agent's slot WITHOUT killing it mid-call:
  // write its pending tool_call's defer fence so request_permission RETURNS, the
  // turn ends cleanly, and the agent goes idle. Returns false (→ caller hard-kills)
  // when no pending tool_call approval is found.
  const deferParkedAgent = (agentId: string): boolean => {
    const apvRepo = createApprovalsRepository(db);
    const pending = apvRepo
      .listByAgent(agentId)
      .find((a) => a.status === "pending" && a.kind === "tool_call");
    if (pending === undefined) return false;
    let toolUseId: string | undefined;
    try {
      toolUseId = (JSON.parse(pending.payloadJson) as { tool_use_id?: string }).tool_use_id;
    } catch {
      return false;
    }
    if (toolUseId === undefined || toolUseId === "") return false;
    try {
      writeFileSync(
        join(permDir, `${toolUseId}.defer.json`),
        JSON.stringify({ behavior: "deferred" }),
      );
    } catch {
      return false;
    }
    return true;
  };

  // Wake agents whose deferred approval has since been decided. request_permission
  // drops a <approvalId>.deferred.json marker when it defers; once the approval is
  // decided we re-engage the agent (one-shot — marker deleted). On approve we also
  // pre-approve the identical retry so it doesn't re-route (completes the decision
  // the user/CEO already made, not a new grant).
  const reengageDeferredApprovals = (): void => {
    let files: string[];
    try {
      files = readdirSync(permDir).filter((f) => f.endsWith(".deferred.json"));
    } catch {
      return;
    }
    const apvRepo = createApprovalsRepository(db);
    for (const f of files) {
      const p = join(permDir, f);
      let marker: {
        agentId: string;
        toolName: string;
        toolInput: Record<string, unknown>;
        approvalId: string;
      };
      try {
        marker = JSON.parse(readFileSync(p, "utf8")) as typeof marker;
      } catch {
        safeUnlinkFile(p);
        continue;
      }
      const apv = apvRepo.getById(marker.approvalId);
      if (apv === null) {
        safeUnlinkFile(p);
        continue;
      }
      if (apv.status === "pending") continue; // not decided yet — keep the marker
      safeUnlinkFile(p); // decided → one-shot re-engage
      if (apv.status === "approved") {
        try {
          const key = preapprovalKey(marker.toolName, marker.toolInput);
          writeFileSync(
            preapprovalPath(permDir, marker.agentId, key),
            JSON.stringify({ at: Date.now() }),
          );
        } catch {
          /* best-effort — without it the retry just re-routes once */
        }
        deliverSystemMessage(
          marker.agentId,
          `Sua ação "${marker.toolName}" foi APROVADA. Execute-a agora para concluir a tarefa.`,
        );
      } else {
        deliverSystemMessage(
          marker.agentId,
          `Sua ação "${marker.toolName}" foi recusada${apv.decisionNote !== null ? `: ${apv.decisionNote}` : ""}. Siga sem ela.`,
        );
      }
    }
  };

  // Runtime auto-heal (B, v0.1.40): an agent stuck in `error` with no live
  // process (a fast exit-1 from an orphaned --resume, a transient spawn failure)
  // would otherwise sit stuck until the next app restart (boot-heal only runs at
  // startup). Reset it to idle so the scheduler re-engages it from where it left
  // off. Capped per agent so a genuinely-broken agent can't respawn-storm —
  // after MAX_AUTO_HEALS it stays visible in `error`.
  const healErroredAgents = (): void => {
    for (const id of agents.listErroredAgentIds()) {
      if (getAdapter(id)?.isAlive() === true) continue; // a live turn owns it — not stuck
      const attempts = autoHealAttempts.get(id) ?? 0;
      if (attempts >= MAX_AUTO_HEALS) continue; // gave up — leave it visible in `error`
      autoHealAttempts.set(id, attempts + 1);
      agents.updateStatus(id, { status: "idle", currentAction: null });
      broadcast({ kind: "status-changed", agentId: id, status: "idle", updatedAt: Date.now() });
      olog(
        `auto-heal agent=${id} error→idle (attempt ${String(attempts + 1)}/${String(MAX_AUTO_HEALS)})`,
      );
    }
  };

  const drainScheduler = (): void => {
    // Max rate-limit gate. While active, spawn nothing. When the window resets,
    // clear the gate and resume the parked team so each agent continues from
    // where it left off (re-wakes flow through the 4-slot queue below).
    const rlUntil = settingsRepo.read().rateLimitedUntil;
    if (rlUntil !== null) {
      if (Date.now() < rlUntil) return; // still gated — spawn nothing this tick
      settingsRepo.write({ rateLimitedUntil: null });
      const resumed = agents.listByPauseReason("rate_limited");
      for (const a of resumed) {
        agents.resume(a.id); // status → idle, pause_reason cleared
        broadcast({ kind: "status-changed", agentId: a.id, status: "idle", updatedAt: Date.now() });
        deliverSystemMessage(
          a.id,
          "[LIMITE DO MAX RESETADO] A cota voltou. Continue sua tarefa de onde parou — releia a issue/thread ou o contexto do projeto se precisar.",
        );
      }
      if (resumed.length > 0) {
        console.warn(`[ratelimit] window reset — resumed ${String(resumed.length)} agent(s)`);
      }
    }
    const isCeoId = (id: string): boolean => {
      const a = agents.getById(id);
      return a !== null && isCeoAgent(a);
    };
    healErroredAgents();
    reengageDeferredApprovals();
    const running = listAdapterAgentIds().map((id) => {
      const status = agents.getById(id)?.status ?? "idle";
      return {
        id,
        isCeo: isCeoId(id),
        hasWork: status !== "idle" || router.hasPendingWork(id),
        // "waiting" = blocked on a pending approval (set in index.ts on each
        // permission request). Such an agent holds a slot but makes no progress,
        // so it's evictable via a clean defer (below) — otherwise it starves
        // newly-delegated agents that can never get a slot (v0.1.37 wake bug).
        parked: status === "waiting",
      };
    });
    const runningSet = new Set(running.map((r) => r.id));
    const waiting = router
      .listPendingAgentIds()
      // pending work but no live adapter, AND not itself blocked on an approval
      // (a parked agent has nothing to do until its approval is decided — don't
      // re-spawn it into the slot we just reclaimed; the re-engage sweep wakes it).
      .filter((id) => !runningSet.has(id) && (agents.getById(id)?.status ?? "idle") !== "waiting")
      .map((id) => ({ id, isCeo: isCeoId(id), hasWork: true }));
    if (running.length === 0 && waiting.length === 0) return; // short-circuit common idle case
    // Lane-aware: reserve one slot so the CEO can always spawn to decide approvals.
    const { toSpawn, toEvict } = computeLaneSchedule(running, waiting, MAX_CONCURRENT_AGENTS);
    for (const id of toEvict) {
      // A parked (approval-blocked) victim is reclaimed by a CLEAN defer, not a
      // hard kill: its request_permission poll returns, the turn ends, the agent
      // goes idle (slot frees next pass), the approval stays pending, and the
      // re-engage sweep wakes it once decided. Truly-idle victims have no
      // in-flight turn, so a kill is safe (session preserved for --resume).
      if (agents.getById(id)?.status === "waiting" && deferParkedAgent(id)) continue;
      getAdapter(id)?.kill();
      removeAdapter(id);
    }
    for (const id of toSpawn) {
      const a = agents.getById(id);
      if (a !== null) ensureAgentRunner(a); // slot is free → spawns + deliverQueued fires in .then
    }
  };

  // Periodic tick: 8 s — ensures an org that is stalled due to a missed event
  // catches up within one tick window.
  const stopScheduler = startSchedulerTick(drainScheduler, 8_000);

  // M15 PR-A — wire the routines engine's bridge now that router and
  // ensureAgentRunner are in scope. The engine ticks immediately on start
  // so any due-on-boot routine fires from inside this call (catch-up).
  const routinesEngine = tryGetRoutinesEngine();
  if (routinesEngine !== null) {
    routinesEngine.start({
      getAgent: (id) => agents.getById(id),
      ensureAgentRunner: (agent) => ensureAgentRunner(agent),
      enqueue: (agentId, threadId, content, sender) =>
        router.enqueue(agentId, threadId, content, sender, null),
      primaryThreadId: (agentId) =>
        messages.ensureThread(agents.getById(agentId)?.companyId ?? "", ["user", agentId]).id,
    });
  }
  registerRoutinesHandlers(db);

  // CEO approval engine: route approval requests to the CEO (or escalate to human).
  const approvalRecorder = tryGetRecorder();
  setApprovalEngineBridge({
    db,
    getAgent: (id) => agents.getById(id),
    getCeo: (companyId) => findActiveCeo(agents.listByCompany(companyId)),
    ensureAgentRunner: (agent) => ensureAgentRunner(agent),
    enqueue: (agentId, threadId, content, sender) =>
      router.enqueue(agentId, threadId, content, sender, null),
    primaryThreadId: (agentId) =>
      messages.ensureThread(agents.getById(agentId)?.companyId ?? "", ["user", agentId]).id,
    recordActivity: (input) => {
      approvalRecorder?.recordActivity(input);
    },
    createHumanCard: (approvalId) => {
      const apv = createApprovalsRepository(db).getById(approvalId);
      if (apv === null || apv.agentId === null) return;
      const agent = agents.getById(apv.agentId);
      if (agent === null) return;
      const payload = JSON.parse(apv.payloadJson) as Record<string, unknown>;
      const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
      const isManager = apv.kind === "manager_request";
      inbox.create({
        companyId: agent.companyId,
        kind: isManager ? "manager_request" : "approval",
        actorId: agent.id,
        title: isManager
          ? `Decisao pedida: ${asStr(payload["topic"])}`
          : `Approval needed: ${asStr(payload["tool_name"])}`,
        preview: isManager
          ? asStr(payload["summary"]).slice(0, 200)
          : JSON.stringify(payload["tool_input"] ?? {}).slice(0, 200),
        requiresAction: true,
        payloadJson: apv.payloadJson,
        approvalId: apv.id,
      });
      broadcastInboxUpdate(agent.companyId);
    },
    createCeoDecisionCard: (approvalId, decision) => {
      const apv = createApprovalsRepository(db).getById(approvalId);
      if (apv === null || apv.agentId === null) return;
      const agent = agents.getById(apv.agentId);
      if (agent === null) return;
      const payload = JSON.parse(apv.payloadJson) as Record<string, unknown>;
      const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
      const what =
        apv.kind === "manager_request"
          ? asStr(payload["topic"]) || "decisao"
          : asStr(payload["tool_name"]) || "ferramenta";
      inbox.create({
        companyId: agent.companyId,
        kind: "ceo_decision",
        actorId: agent.id,
        title: `CEO ${decision === "approved" ? "aprovou" : "rejeitou"}: ${what}`,
        preview: `Requisitante: ${agent.name}`,
        requiresAction: false,
        payloadJson: JSON.stringify({ approvalId: apv.id, kind: apv.kind, decision }),
        approvalId: apv.id,
      });
      broadcastInboxUpdate(agent.companyId);
    },
  });

  // Boot recovery: any CEO-routed approval still pending → escalate to human;
  // any user-routed approval past its bounce TTL → bounce to CEO.
  {
    const companyIds = (db.prepare("SELECT id FROM companies").all() as { id: string }[]).map(
      (r) => r.id,
    );
    escalatePendingOnBoot(db, companyIds);
    armBouncesOnBoot(db, companyIds);
  }

  // v0.1.22 heal: clear stale rateLimitedUntil from the allowed_warning
  // false-positive bug. The Claude CLI emits status="allowed_warning" when
  // approaching the weekly cap (NOT throttled yet); pre-fix the parser
  // treated it as a throttle and parked the team with rateLimitedUntil set
  // to the weekly reset (often 10+ hours out). Real session rate-limits
  // reset within 5 hours; anything further out is almost certainly bug
  // residue. We "expire" the gate now so drainScheduler picks it up on its
  // next tick and resumes the team via the existing auto-resume branch. If
  // the account IS actually weekly-rate-limited, the next claude call will
  // re-emit a real throttle event and we'll re-park the team correctly.
  {
    const STALE_THRESHOLD_MS = 5 * 60 * 60_000;
    const settings = settingsRepo.read();
    if (
      settings.rateLimitedUntil !== null &&
      settings.rateLimitedUntil - Date.now() > STALE_THRESHOLD_MS
    ) {
      settingsRepo.write({ rateLimitedUntil: Date.now() - 1000 });
    }
  }

  // Re-wake the CEO for any approvals routed to the CEO but not yet decided
  // before restart. Escalating to human (old behavior) would stall CEO-driven
  // workflows; instead we re-wake the CEO so it can decide them normally.
  try {
    const companyRows = db.prepare("SELECT id FROM companies").all() as { id: string }[];
    const approvalsRepo = createApprovalsRepository(db);
    for (const { id: companyId } of companyRows) {
      const pending = approvalsRepo.listPendingRoutedToCeo(companyId);
      if (pending.length === 0) continue;
      const ceo = findActiveCeo(agents.listByCompany(companyId));
      if (ceo === null) {
        // No active CEO in this company — nothing to re-wake; leave pending for
        // human resolution (the human can decide via inbox).
        console.warn(`[approvals] boot: no active CEO for company ${companyId}; skipping re-wake`);
        continue;
      }
      for (const apv of pending) {
        const payloadParsed = JSON.parse(apv.payloadJson) as Record<string, unknown>;
        const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
        const requesterAgent = apv.agentId !== null ? agents.getById(apv.agentId) : null;
        const requesterName = requesterAgent?.name ?? "Agente";
        const summary =
          apv.kind === "manager_request"
            ? asStr(payloadParsed["summary"])
            : asStr(payloadParsed["tool_name"]);
        wakeCeoForApproval(
          { approvalId: apv.id, companyId, requesterName, summary, kind: apv.kind },
          {
            getCeo: (_cid) => ceo,
            ensureAgentRunner: (a) => ensureAgentRunner(a),
            enqueue: (agentId, threadId, content, sender) =>
              router.enqueue(agentId, threadId, content, sender, null),
            primaryThreadId: (agentId) =>
              messages.ensureThread(agents.getById(agentId)?.companyId ?? "", ["user", agentId]).id,
            recordActivity: (input) => {
              tryGetRecorder()?.recordActivity(input);
            },
          },
        );
        // Arm the escalation timer so a CEO who never decides gets escalated to
        // the human after CEO_DECISION_TIMEOUT_MS. The runtime path (routeAndDispatch)
        // arms it via timers.arm(); the boot re-wake path was missing this, leaving
        // approvals pending forever. Decide-on-either-kind already cancels the timer.
        tryGetApprovalTimers()?.arm(apv.id);
        console.log(`[approvals] boot: re-woke CEO for pending approval ${apv.id}`);
      }
    }
  } catch (err) {
    console.warn("[approvals] boot CEO re-wake failed", err);
  }

  // P2-C — Auto-mode expiry: revert agents from 'auto' to 'supervised' after 24h.
  // Runs one tick immediately (catches agents that expired while the app was closed)
  // then checks every 5 minutes. The checker is intentionally not exposed for
  // stop() — it lives for the lifetime of the app and is garbage-collected on exit.
  const autoExpiryRecorder = tryGetRecorder();
  createAutoModeExpiry({
    now: () => Date.now(),
    listExpiredAutoAgents: (now, expiryMs) => agents.listExpiredAutoAgents(now, expiryMs),
    setModeToSupervised: (agentId) => agents.setMode(agentId, "supervised"),
    createInboxItem: (input) => inbox.create(input),
    // Only pass recorder when defined — exactOptionalPropertyTypes forbids
    // passing { recorder: undefined } for an optional field.
    ...(autoExpiryRecorder !== undefined ? { recorder: autoExpiryRecorder } : {}),
    onAgentReverted: (agentId, companyId) => {
      broadcast({ kind: "roster-changed", companyId });
      // Broadcast a status-changed so the renderer's agent card immediately
      // reflects the mode revert without waiting for a full roster refresh.
      broadcast({
        kind: "status-changed",
        agentId,
        status: agents.getById(agentId)?.status ?? "idle",
        updatedAt: Date.now(),
      });
    },
  }).start();

  // Restart helper for config mutations. Trocar --model / --allowedTools /
  // --system-prompt exige re-spawn (claude lê esses args só na inicialização).
  // Kills runner if alive, zera claude_session_id pra próxima mensagem não
  // tentar --resume com session stale, e broadcast roster pra UI re-render.
  const restartIfRunning = (
    agentId: string,
    companyId: string,
    opts: { resume?: boolean } = {},
  ): void => {
    const a = getAdapter(agentId);
    const wasRunning = a !== undefined && a.isAlive();
    if (wasRunning) {
      a.kill();
      removeAdapter(agentId);
    }
    agents.clearSessionId(agentId);
    agents.updateStatus(agentId, { status: "idle", currentAction: null });
    currentActionDebouncer.cancel(agentId);
    broadcast({ kind: "current-action-changed", agentId, action: null });
    broadcast({ kind: "roster-changed", companyId });
    // A config change that needs new spawn args (model / role / system prompt /
    // capabilities / permissions) must NOT strand an agent that was actively
    // working: re-spawn it and wake it to continue, otherwise it sits idle
    // forever (the "agents stop and never resume" bug). Reset-session callers
    // omit resume — they intentionally want a clean stop.
    if (wasRunning && opts.resume === true) {
      const fresh = agents.getById(agentId);
      if (fresh !== null) {
        ensureAgentRunner(fresh);
        const thread = messages.ensureThread(companyId, ["user", agentId]);
        router.enqueue(
          agentId,
          thread.id,
          "[CONFIG UPDATED] Your configuration changed and your session was restarted. Continue your current task from where you left off — re-read the relevant issue, thread, or project context to re-orient if needed.",
          { kind: "user", id: null, name: "System" },
          null,
        );
      }
    }
  };

  ipcMain.handle(IPC.AGENT_LIST, (_e, payload: { companyId: string }): Agent[] =>
    agents.listByCompany(payload.companyId),
  );

  ipcMain.handle(IPC.AGENT_KILL, (_e, payload: { agentId: string }): void => {
    const a = getAdapter(payload.agentId);
    a?.kill();
    removeAdapter(payload.agentId);
    agents.updateStatus(payload.agentId, { status: "idle", currentAction: null });
    currentActionDebouncer.cancel(payload.agentId);
    const agent = agents.getById(payload.agentId);
    broadcast({
      kind: "status-changed",
      agentId: payload.agentId,
      status: "idle",
      updatedAt: Date.now(),
    });
    broadcast({ kind: "current-action-changed", agentId: payload.agentId, action: null });
    if (agent !== null) {
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
    }
  });

  ipcMain.handle(
    IPC.AGENTS_SET_ALLOWED_PROJECTS,
    (_e, payload: { agentId: string; projectIds: string[] }): void => {
      agents.setAllowedProjects(payload.agentId, payload.projectIds);
    },
  );

  ipcMain.handle(
    IPC.AGENT_SEND_MESSAGE,
    (
      _e,
      payload: { agentId: string; content: string; attachmentIds?: string[] },
    ): Promise<Message> => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      const attachmentIds = payload.attachmentIds ?? [];

      const userMessage = messages.append({
        companyId: agent.companyId,
        participants: ["user", agent.id],
        senderKind: "user",
        senderId: null,
        content: payload.content,
      });

      // Link pending attachments to this message and move their files from
      // `pending/<aId>/<filename>` to `<messageId>/<aId>/<filename>`. The
      // DB update + FS move runs in a transaction so a mid-loop crash leaves
      // either everything linked-and-moved or nothing (transaction rolls back
      // the DB; orphan files in pending/ are swept by the GC at boot).
      if (attachmentIds.length > 0) {
        const userDataDir = app.getPath("userData");
        const attachmentsRoot = join(userDataDir, "attachments");

        db.transaction(() => {
          for (const aId of attachmentIds) {
            const row = db
              .prepare(
                "SELECT local_path as localPath, filename FROM message_attachments WHERE id = ? AND message_id IS NULL",
              )
              .get(aId) as { localPath: string; filename: string } | undefined;
            if (row === undefined) continue;

            const newPath = join(attachmentsRoot, userMessage.id, aId, row.filename);
            mkdirSync(dirname(newPath), { recursive: true });
            renameSync(row.localPath, newPath);

            // Clean up the now-empty pending/<id>/ dir
            try {
              rmdirSync(dirname(row.localPath));
            } catch {
              // ignore — directory may have residual contents
            }

            db.prepare(
              "UPDATE message_attachments SET message_id = ?, local_path = ? WHERE id = ?",
            ).run(userMessage.id, newPath, aId);
          }
        })();
      }

      broadcast({
        kind: "message-append",
        agentId: agent.id,
        message: { ...userMessage, threadParticipants: ["user", agent.id].sort() },
      });

      ensureAgentRunner(agent);
      enqueueOrPark(
        agent,
        router,
        userMessage.threadId,
        payload.content,
        {
          kind: "user",
          id: null,
          name: "User",
        },
        userMessage.id,
      );
      return Promise.resolve(userMessage);
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_MODEL,
    (_e, payload: { agentId: string; model: string }): { ok: true } => {
      // Defense-in-depth: re-validate model id even though renderer also validates.
      // Prevents shell-injection via --model arg if the renderer is bypassed.
      if (!MODEL_ID_REGEX.test(payload.model)) throw new Error("Invalid model id");
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setModel(payload.agentId, payload.model);
      restartIfRunning(payload.agentId, agent.companyId, { resume: true });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_ROLE,
    (
      _e,
      payload: { agentId: string; roleTemplateId: string; preserveModel?: boolean },
    ): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setRole(payload.agentId, payload.roleTemplateId, {
        preserveModel: payload.preserveModel === true,
      });
      restartIfRunning(payload.agentId, agent.companyId, { resume: true });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_SYSTEM_PROMPT,
    (_e, payload: { agentId: string; systemPrompt: string }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setSystemPrompt(payload.agentId, payload.systemPrompt);
      restartIfRunning(payload.agentId, agent.companyId, { resume: true });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_REPORTS_TO,
    (_e, payload: { agentId: string; reportsTo: string | null }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setReportsTo(payload.agentId, payload.reportsTo);
      // reports_to é metadata visual; não afeta spawn args → não precisa restart.
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_ADAPTER,
    (_e, payload: { agentId: string; adapterName: string }): { ok: true } => {
      const valid = ["claude-oauth-local", "claude-api-key-local", "claude-oauth-remote-docker"];
      if (!valid.includes(payload.adapterName)) throw new Error("Invalid adapter");
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setAdapterName(payload.agentId, payload.adapterName);
      // No restart: the next spawn reads the new adapter_name (design §7.3).
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_MODE,
    (_e, payload: { agentId: string; mode: AgentMode }): { ok: true } => {
      if (payload.mode !== "supervised" && payload.mode !== "auto") {
        throw new Error("Invalid mode");
      }
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setMode(payload.agentId, payload.mode);
      // Mode (supervised/auto) is enforced LIVE by the gate per permission
      // request (permission-watcher fetches the agent fresh → gate reads
      // agent.mode), so it needs NO respawn. The old restartIfRunning here
      // killed the working agent and stranded it idle — the bug where switching
      // to auto made the agent "stop and never return". Just persist + refresh UI.
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_ALWAYS_ON,
    (_e, payload: { agentId: string; alwaysOn: boolean }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setAlwaysOn(payload.agentId, payload.alwaysOn);
      // alwaysOn é flag de startup do orchestrator; não exige restart do agente vivo.
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_CAPABILITIES,
    (_e, payload: { agentId: string; capabilities: string[] }): { ok: true } => {
      if (
        !Array.isArray(payload.capabilities) ||
        payload.capabilities.some((s) => typeof s !== "string")
      ) {
        throw new Error("capabilities must be string[]");
      }
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setCapabilities(payload.agentId, payload.capabilities);
      // capabilities afeta --allowedTools no spawn → exige re-spawn.
      restartIfRunning(payload.agentId, agent.companyId, { resume: true });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_BUDGET,
    (
      _e,
      payload: {
        agentId: string;
        tokensLimit: number | null;
        usdLimit: number | null;
        period: BudgetPeriod;
      },
    ): { ok: true } => {
      if (payload.period !== "daily" && payload.period !== "monthly") {
        throw new Error("Invalid budget period");
      }
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      // Repo throws on a non-positive, non-null limit.
      agents.setBudget(payload.agentId, {
        tokensLimit: payload.tokensLimit,
        usdLimit: payload.usdLimit,
        period: payload.period,
      });
      // No re-spawn: enforcement reads the DB each turn post-completion.
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_PERMISSIONS,
    (_e, payload: { agentId: string; canHire: boolean; canAssign: boolean }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setPermissions(payload.agentId, {
        canHire: payload.canHire,
        canAssign: payload.canAssign,
      });
      // can_hire/can_assign affect --allowedTools at spawn → re-spawn.
      restartIfRunning(payload.agentId, agent.companyId, { resume: true });
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.AGENTS_STATS, (_e, payload: { agentId: string }): AgentStats => {
    const row = db
      .prepare(
        `SELECT COUNT(*) as n, MAX(created_at) as last
         FROM messages WHERE sender_kind = 'agent' AND sender_id = ?`,
      )
      .get(payload.agentId) as { n: number; last: number | null };
    return {
      turns: row.n,
      tokensIn: null,
      tokensOut: null,
      lastActivityAt: row.last,
    };
  });

  ipcMain.handle(
    IPC.AGENTS_PAUSE,
    (_e, payload: { agentId: string; reason?: string }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      if (agent.status === "terminated") throw new Error("Cannot pause a terminated agent");
      // Stop the running turn too (not just park new messages).
      pauseAndStopAgent(payload.agentId, payload.reason, {
        getAdapter,
        removeAdapter,
        pause: (id, r) => agents.pause(id, r),
      });
      broadcast({
        kind: "status-changed",
        agentId: payload.agentId,
        status: "paused",
        updatedAt: Date.now(),
      });
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_RESUME,
    (_e, payload: { agentId: string }): { ok: true; drained: number } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      if (agent.status !== "paused") throw new Error("Agent is not paused");
      agents.resume(payload.agentId);
      const drained = drainPausedBacklog(payload.agentId, router);
      broadcast({
        kind: "status-changed",
        agentId: payload.agentId,
        status: "idle",
        updatedAt: Date.now(),
      });
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true, drained };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_TERMINATE,
    (_e, payload: { agentId: string; reason?: string }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      const a = getAdapter(payload.agentId);
      if (a !== undefined && a.isAlive()) {
        a.kill();
        removeAdapter(payload.agentId);
      }
      agents.terminate(payload.agentId, payload.reason);
      pauseBacklog.delete(payload.agentId);
      pendingTurnByAgent.delete(payload.agentId);
      currentActionDebouncer.cancel(payload.agentId);
      broadcast({
        kind: "status-changed",
        agentId: payload.agentId,
        status: "terminated",
        updatedAt: Date.now(),
      });
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.AGENTS_WAKE_UP, (_e, payload: { agentId: string }): { ok: true } => {
    const agent = agents.getById(payload.agentId);
    if (agent === null) throw new Error("Agent not found");
    if (agent.status === "paused" || agent.status === "terminated") {
      throw new Error(`Agent is ${agent.status}; resume it first`);
    }
    ensureAgentRunner(agent);
    const thread = messages.ensureThread(agent.companyId, ["user", agent.id]);
    router.enqueue(
      agent.id,
      thread.id,
      "User requested manual run.",
      { kind: "user", id: null, name: "User" },
      null,
    );
    return { ok: true };
  });

  ipcMain.handle(IPC.AGENTS_RESET_SESSION, (_e, payload: { agentId: string }): { ok: true } => {
    const agent = agents.getById(payload.agentId);
    if (agent === null) throw new Error("Agent not found");
    restartIfRunning(payload.agentId, agent.companyId);
    return { ok: true };
  });

  ipcMain.handle(IPC.AGENTS_HIRE_FROM_UI, (_e, payload: unknown): Agent => {
    const parsed = HIRE_FROM_UI_INPUT_SCHEMA.parse(payload);
    const authMode = getActiveAuthMode(db);
    const adapterName = pickAdapterForHire(parsed.location, authMode);
    const created = agents.create({
      companyId: parsed.company_id,
      name: parsed.name,
      role: parsed.role,
      systemPrompt: parsed.system_prompt,
      mode: parsed.mode ?? "supervised",
      alwaysOn: false,
      templateId: parsed.role_template_id ?? null,
      adapterName,
      actor: { kind: "user" },
    });
    if (parsed.reports_to !== undefined && parsed.reports_to !== "") {
      agents.setReportsTo(created.id, parsed.reports_to);
    }
    broadcast({ kind: "roster-changed", companyId: created.companyId });
    return created;
  });

  // M8.5 — Goals + CEO Planning. Wire orchestrator bridge so goal-plan
  // requests reach the CEO as a system-from-user message; reuse the same
  // ensureAgentRunner + router.enqueue path as AGENT_SEND_MESSAGE.
  const deliverSystemMessage = (agentId: string, text: string): void => {
    const agent = agents.getById(agentId);
    if (agent === null) return;
    ensureAgentRunner(agent);
    const thread = messages.ensureThread(agent.companyId, ["user", agent.id]);
    router.enqueue(agent.id, thread.id, text, { kind: "user", id: null, name: "System" }, null);
  };

  // M8.6 — Narrated execution. Enqueue a system-actor turn carrying the
  // [GOAL_EXECUTE_REQUEST] payload and return the thread id so executor can
  // persist it in goals.execution_state_json.
  const enqueueExecuteRequest = (ceoId: string, prompt: string): { threadId: string } => {
    const ceo = agents.getById(ceoId);
    if (ceo === null) throw new Error(`ceo ${ceoId} not found`);
    ensureAgentRunner(ceo);
    const thread = messages.ensureThread(ceo.companyId, ["user", ceo.id]);
    router.enqueue(ceo.id, thread.id, prompt, { kind: "user", id: null, name: "System" }, null);
    return { threadId: thread.id };
  };

  // Safety-net reconciler (60s tick): the scheduler only sees the in-memory
  // router queue, so an idle team with a full issue board never re-engages on
  // its own (observed: 16 idle agents with 15 'todo' + 10 'review' unworked).
  // Wake the LIVE CEO (findActiveCeo) to orchestrate — review 'review' items,
  // assign/unblock pending work. Debounced per-CEO and skipped while the CEO is
  // already engaged. Lives for the app's lifetime (mirrors auto-mode-expiry).
  {
    const issuesRepo = createIssuesRepository(db);
    const goalsRepoR = createGoalsRepository(db);
    const criteriaRepoR = createGoalCriteriaRepository(db);
    const retryableFailedGoals = (companyId: string): VerificationFailedGoal[] => {
      const out: VerificationFailedGoal[] = [];
      const inProgress = goalsRepoR
        .listByCompany(companyId)
        .filter((g) => g.status === "in_progress");
      for (const goal of inProgress) {
        const goalIssues = issuesRepo.listByGoal(goal.id);
        const allTerminal =
          goalIssues.length > 0 &&
          goalIssues.every((i) => i.status === "done" || i.status === "cancelled");
        if (!allTerminal) continue;
        const criteria = criteriaRepoR.listByGoal(goal.id);
        const failedDet = criteria.filter(
          (c) => c.kind === "deterministic" && c.status === "failed",
        );
        if (failedDet.length === 0) continue;
        if (!failedDet.some((c) => c.attempts <= RETRY_CAP)) continue;
        out.push({
          id: goal.id,
          title: goal.title,
          failedCriteria: failedDet.map((c) => c.statement),
        });
      }
      return out;
    };
    const reconcileLastWakeByCeo = new Map<string, number>();
    const RECONCILE_DEBOUNCE_MS = 3 * 60_000;
    const reconcileTick = (): void => {
      // Don't reconcile while the team is parked on a Max rate-limit window.
      const rlUntil = settingsRepo.read().rateLimitedUntil;
      if (rlUntil !== null && Date.now() < rlUntil) return;
      const companyRows = db.prepare("SELECT id FROM companies").all() as { id: string }[];
      for (const { id: companyId } of companyRows) {
        const roster = agents.listByCompany(companyId);
        const ceo = findActiveCeo(roster);
        const isEngaged = (a: Agent): boolean =>
          (getAdapter(a.id)?.isAlive() ?? false) || router.hasPendingWork(a.id);
        const decision = computeReconcileDecision({
          ceoId: ceo?.id ?? null,
          ceoEngaged: ceo !== null ? isEngaged(ceo) : false,
          anyWorkerEngaged: roster.some(
            (a) => a.terminatedAt === null && !isCeoAgent(a) && isEngaged(a),
          ),
          counts: {
            todo: issuesRepo.list({ companyId, status: "todo" }).length,
            doing: issuesRepo.list({ companyId, status: "doing" }).length,
            review: issuesRepo.list({ companyId, status: "review" }).length,
          },
          verificationFailedGoals: retryableFailedGoals(companyId),
          ceoLastWakeAt: ceo !== null ? (reconcileLastWakeByCeo.get(ceo.id) ?? null) : null,
          now: Date.now(),
          debounceMs: RECONCILE_DEBOUNCE_MS,
        });
        if (decision.wake) {
          deliverSystemMessage(decision.ceoId, decision.summary);
          reconcileLastWakeByCeo.set(decision.ceoId, Date.now());
          console.log(`[reconcile] woke CEO ${decision.ceoId} for company ${companyId}`);
        }
      }
    };
    startSchedulerTick(reconcileTick, 60_000);
  }

  registerGoalsHandlers({
    db,
    orchestrator: { deliverSystemMessage, enqueueExecuteRequest },
  });

  // M8.6 — Narrated resume/rollback handlers + settings executor mode IPCs.
  registerNarratedHandlers({
    db,
    orchestrator: { deliverSystemMessage, enqueueExecuteRequest },
  });

  ipcMain.handle(IPC.SETTINGS_GET_EXECUTOR_MODE, () =>
    createSettingsRepository(db).getExecutorMode(),
  );
  ipcMain.handle(IPC.SETTINGS_SET_EXECUTOR_MODE, (_e, mode: "atomic" | "narrated") => {
    createSettingsRepository(db).setExecutorMode(mode);
    return { ok: true };
  });

  ipcMain.handle(
    IPC.REMOTE_TEST_CONNECTION,
    (): Promise<TestConnectionResult> => testRemoteConnection(),
  );

  // Boot recovery — re-enqueue [GOAL_PLAN_REQUEST] for goals stuck in 'planning'
  // with no proposed plan (CEO crash mid-turn). Runs once after orchestrator is
  // ready. Idempotent: re-running finds nothing because the CEO turn will
  // either produce a plan (status moves to proposed) or fail again (logged).
  try {
    const recovered = scanPlanningWithoutPlan(db, { deliverSystemMessage });
    if (recovered > 0) {
      console.log(`[goals] recovery scanned ${recovered} stuck planning goal(s)`);
    }
  } catch (e) {
    console.error("[goals] recovery scan failed", e);
  }

  // C2 (audit 2026-06-03): recover goals stranded `in_progress` with every issue
  // terminal (pre-fix leftovers, or a dropped issue.updated event). Idempotent.
  try {
    const recoveredGoals = scanStrandedInProgress(db, buildVerificationDeps());
    if (recoveredGoals.length > 0) {
      console.log(`[goals] recovered ${recoveredGoals.length} stranded in_progress goal(s)`);
    }
  } catch (e) {
    console.error("[goals] stranded in_progress scan failed", e);
  }

  // I-prop (audit 2026-06-03): re-file the approval card for goals stuck in
  // `proposed` whose goal_proposed inbox card was lost — otherwise the goal
  // sits forever, invisibly. Idempotent (skips goals that still have an open
  // card). Broadcast so a running renderer picks up the re-filed card.
  try {
    const refiled = scanProposedWithoutCard(db);
    if (refiled.length > 0) {
      console.log(`[goals] re-filed ${refiled.length} lost goal_proposed card(s)`);
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.INBOX_UPDATE, {});
        }
      } catch {
        /* boot may be pre-window */
      }
    }
  } catch (e) {
    console.error("[goals] proposed-without-card scan failed", e);
  }

  // M8.6 + I-narr (audit 2026-06-03): a narrated execution halted mid-loop (CEO
  // max-turns, app crash) used to only file a goal_error card for the human to
  // resume by hand — the loop just stopped. Since the per-plan tools are
  // idempotent, auto-resume re-enqueues the CEO execute-request; only goals
  // that genuinely can't resume fall back to a card.
  try {
    const { resumed, flagged } = resumeStuckNarrated(db, { enqueueExecuteRequest });
    if (resumed.length > 0) {
      console.log(`[goals/narrated] auto-resumed ${resumed.length} stuck narrated execution(s)`);
    }
    if (flagged.length > 0) {
      console.log(`[goals/narrated] flagged ${flagged.length} unresumable narrated execution(s)`);
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.INBOX_UPDATE, {});
        }
      } catch {
        /* boot may be pre-window */
      }
    }
  } catch (e) {
    console.error("[goals/narrated] recovery scan failed", e);
  }

  // Boot drain: after all recovery scans have re-enqueued pending messages,
  // immediately attempt to spawn waiting agents so they don't stall until the
  // first periodic tick (8 s).
  try {
    drainScheduler();
  } catch (e) {
    console.error("[scheduler] boot drain failed", e);
  }

  return { stopScheduler, router };
};
