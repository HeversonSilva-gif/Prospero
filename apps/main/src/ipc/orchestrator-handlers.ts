import { ipcMain, BrowserWindow, app } from "electron";
import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  IPC,
  MODEL_ID_REGEX,
  type Agent,
  type AgentAdapter,
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
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { buildMemoryBlock, agentMemoryNearFull } from "../orchestrator/system-prompt-memory.js";
import { buildTelosBlock } from "../orchestrator/system-prompt-telos.js";
import { buildProjectContextBlock } from "../orchestrator/system-prompt-project-context.js";
import { createProjectsRepository } from "../projects/repository.js";
import { composeInstructions } from "../agents/instruction-bundle.js";
import { createRecoveryTracker } from "../orchestrator/recovery-tracker.js";
import { createNudgeTracker } from "../orchestrator/nudge.js";
import { loadDecryptedToken } from "../auth/token-storage.js";
import { loadDecryptedApiKey } from "../auth/api-key-storage.js";
import { getActiveAuthMode } from "../auth/auth-mode.js";
import { ensureAdapter, getAdapter, removeAdapter } from "../orchestrator/lifecycle.js";
import { setRemoteExecutionConfigResolver } from "../orchestrator/adapters/claude-oauth-remote-docker/connection-manager.js";
import { toRemoteExecutionConfig } from "../orchestrator/adapters/claude-oauth-remote-docker/config.js";
import { resolveAdapterCredentials } from "../orchestrator/adapter-credentials.js";
import { pickAdapterForHire } from "../agents/hire-adapter.js";
import {
  testRemoteConnection,
  type TestConnectionResult,
} from "../orchestrator/adapters/claude-oauth-remote-docker/test-connection.js";
import { createRouter } from "../orchestrator/router.js";
import type { Sender } from "../orchestrator/router.js";
import type { ParsedEvent } from "@prospero/shared";
import { mapToolUseToAction } from "../orchestrator/current-action-mapper.js";
import {
  createCurrentActionDebouncer,
  type CurrentActionDebouncer,
} from "../orchestrator/event-throttle.js";
import { databasePath } from "../db/path.js";
import { getPermissionsDir } from "../security/permissions-dir.js";
import { getEventsDir } from "../orchestrator/events-dir.js";
import { registerGoalsHandlers } from "./goals-handlers.js";
import { registerNarratedHandlers } from "./goals-narrated-handlers.js";
import { scanPlanningWithoutPlan, scanStuckNarrated } from "../goals/recovery.js";
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
import { setApprovalEngineBridge, escalatePendingOnBoot } from "../approvals/index.js";
import { handleApprovalEvent } from "../approvals/event-handler.js";
import { createApprovalsRepository } from "../approvals/repository.js";
import { broadcastInboxUpdate } from "./inbox-handlers.js";
import { isCeoAgent } from "@prospero/shared";
import { buildRecoveryTrail } from "../derivation/trail.js";
import { runDerivation, defaultRunProcess } from "../derivation/runner.js";
import { buildAuthEnv } from "../derivation/index.js";
import { createCompactionWorker } from "../context/compaction-worker.js";
import { shouldCompact } from "../context/should-compact.js";
import { hashSources } from "../context/freshness.js";
import { relativeDigestPath } from "../context/digest-dir.js";
import { estimateCostCents } from "../costs/pricing.js";

const broadcast = (event: AgentEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, event);
  }
};

export const registerOrchestratorHandlers = (db: Database.Database): void => {
  const agents = createAgentsRepository(db, tryGetRecorder());
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

  const router = createRouter({
    writeStdin: (agentId, content) => {
      const a = getAdapter(agentId);
      if (a !== undefined && a.isAlive()) a.sendInput(content);
    },
  });

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
      router.enqueue(p.targetId, p.threadId, p.content, sender);
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
      // the renderer's message-append listener refetches and shows it.
      const p = payload as { agentId: string; messageId: string };
      const row = db
        .prepare(
          `SELECT m.id, m.thread_id, m.sender_kind, m.sender_id, m.content,
                  m.kind, m.tool_calls_json, m.created_at FROM messages m WHERE m.id = ?`,
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
          },
        });
      }
    } else if (
      (kind === "issue.created" || kind === "issue.updated") &&
      typeof payload === "object" &&
      payload !== null
    ) {
      const p = payload as { issueId: string };
      const issueRow = db.prepare("SELECT company_id FROM issues WHERE id = ?").get(p.issueId) as
        | { company_id: string }
        | undefined;
      if (issueRow !== undefined) {
        broadcastIssueChanged({
          kind: kind === "issue.created" ? "created" : "updated",
          issueId: p.issueId,
          companyId: issueRow.company_id,
        });
      }
    } else if (
      kind === "approval.route" ||
      kind === "approval.decided" ||
      kind === "approval.escalate"
    ) {
      // CEO-side approval tools run in the MCP child (no engine bridge there);
      // they emit these events so MAIN does the routing/decision work.
      handleApprovalEvent({ kind, agentId: event.agentId, companyId, payload });
    }
  };

  const eventsDir = getEventsDir(app.getPath("userData"));
  void startEventsWatcher({ dir: eventsDir, onEvent: dispatchAgentEvent });

  // Serializes compaction per project (same-agent overlap AND two agents on one
  // project): the digest write is a non-atomic read-modify-write and a redundant
  // distill costs real money. Key = `${companyId}:${projectId}`.
  const compactionInFlight = new Set<string>();
  const lastCompactedAt = new Map<string, number>();
  const COMPACTION_COOLDOWN_MS = 10 * 60_000; // 10 min between compactions per project

  // Memória de Contexto de Projeto (Fase 1): after an idle turn, if the session
  // re-read more cached context than the threshold, distill the session into the
  // project digest (folding durable knowledge), then RESET the agent's session
  // (clear session id + kill/drop the adapter). No seed message is delivered —
  // the agent is idle, so the next real message re-spawns it fresh (no --resume)
  // with the now-richer project-context block injected. Safe: never kills
  // a mid-turn process.
  const maybeCompactAfterTurn = async (agent: Agent, cacheRead: number): Promise<void> => {
    try {
      const threshold = settingsRepo.read().compactionCacheReadThreshold;
      if (!shouldCompact({ cacheRead }, threshold)) return;

      const projectIds = agent.allowedProjects;
      if (projectIds.length !== 1) return;
      const proj = createProjectsRepository(db).getById(projectIds[0]!);
      if (proj === null) return;

      const live = agents.getById(agent.id);
      if (live === null || live.status === "paused" || live.status === "terminated") return;

      const compactionKey = `${agent.companyId}:${proj.id}`;
      if (compactionInFlight.has(compactionKey)) return; // a compaction for this project is already running
      const last = lastCompactedAt.get(compactionKey) ?? 0;
      if (Date.now() - last < COMPACTION_COOLDOWN_MS) return;
      compactionInFlight.add(compactionKey);
      try {
        const trail = buildRecoveryTrail(db, agent.id, 200);
        if (trail === null || trail.messages.length === 0) return;
        const transcript = trail.messages.map((m) => `${m.sender}: ${m.content}`).join("\n");

        const worker = createCompactionWorker({
          userDataDir: app.getPath("userData"),
          runDistill: ({ prompt, model }) =>
            runDerivation(
              { runProcess: defaultRunProcess },
              { prompt, model, env: buildAuthEnv(db) },
            ),
          hashSources: (files) =>
            hashSources(files, (rel) => readFileSync(join(proj.path, rel), "utf8")),
          newId: () => `dig_${randomUUID()}`,
          now: () => Date.now(),
          onCost: (usage, model) =>
            costsRepo.insert({
              companyId: agent.companyId,
              agentId: agent.id,
              projectId: proj.id,
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

        await worker.compact({
          companyId: agent.companyId,
          projectId: proj.id,
          agentId: agent.id,
          transcript,
        });

        lastCompactedAt.set(compactionKey, Date.now());

        createProjectsRepository(db).setDigestPath(
          proj.id,
          relativeDigestPath(agent.companyId, proj.id),
        );

        // Re-check after the async distill: only reset if STILL idle and live.
        const live2 = agents.getById(agent.id);
        if (live2 === null || live2.status === "paused" || live2.status === "terminated") return;
        if (router.getCurrentThread(agent.id) !== null) return; // became busy again
        agents.clearSessionId(agent.id);
        const adapter = getAdapter(agent.id);
        if (adapter !== undefined) {
          adapter.kill();
          removeAdapter(agent.id);
        }
      } finally {
        compactionInFlight.delete(compactionKey);
      }
    } catch (err) {
      console.warn(`[compaction] agent ${agent.id} failed: ${String(err)}`);
    }
  };

  const ensureAgentRunner = (agent: Agent): void => {
    const existing = getAdapter(agent.id);
    if (existing !== undefined && existing.isAlive()) return;

    const adapterName = agent.adapterName ?? "claude-oauth-local";
    const { oauthToken, apiKey } = resolveAdapterCredentials(adapterName, {
      loadOauthToken: () => loadDecryptedToken(db),
      loadApiKey: () => loadDecryptedApiKey(db),
    });

    const collectedToolCalls = new Map<string, ToolCallView>();

    const onError = (err: Error): void => {
      recoveryTracker.markErrored(agent.id);
      console.error(`[claude:${agent.id}] spawn error: ${err.message}`);
      removeAdapter(agent.id);
      agents.clearSessionId(agent.id);
      agents.updateStatus(agent.id, { status: "error", currentAction: null });
      broadcast({ kind: "error", agentId: agent.id, message: err.message });
      broadcast({
        kind: "status-changed",
        agentId: agent.id,
        status: "error",
        updatedAt: Date.now(),
      });
      currentActionDebouncer.cancel(agent.id);
      broadcast({ kind: "current-action-changed", agentId: agent.id, action: null });
    };

    // M11: assemble the memory & skills system-prompt block host-side (DB +
    // userData access live here, not in build-args) and thread it through.
    const memoryBlock = buildMemoryBlock({
      memoriesRepo: createMemoriesRepository(db),
      skillsRepo: createSkillsRepository(db),
      userDataDir: app.getPath("userData"),
      companyId: agent.companyId,
      agentId: agent.id,
      role: agent.role,
    });

    // M12 PR-C: assemble the agent's instruction bundle (charter + extras) from
    // disk — same host-side pattern as buildMemoryBlock.
    const instructionsBlock = composeInstructions(app.getPath("userData"), agent);

    // M13 PR-C: assemble the TELOS system-prompt block host-side.
    const telosBlock = buildTelosBlock({
      userDataDir: app.getPath("userData"),
      companyId: agent.companyId,
      agentRole: agent.role,
      agentTemplateId: agent.templateId,
    });

    // Memória de Contexto de Projeto: inject the per-project digest map when the
    // agent is scoped to exactly one project (so the digest target is unambiguous).
    let projectContextBlock: string | undefined;
    const ctxProjectIds = agent.allowedProjects;
    if (ctxProjectIds.length === 1) {
      const proj = createProjectsRepository(db).getById(ctxProjectIds[0]!);
      if (proj !== null) {
        projectContextBlock = buildProjectContextBlock({
          userDataDir: app.getPath("userData"),
          companyId: agent.companyId,
          projectId: proj.id,
          projectPath: proj.path,
        });
      }
    }

    // Guard against stale exits: capture the adapter instance returned by
    // ensureAdapter so onExit can verify it is still the current spawn for
    // this agent. When restartIfRunning / AGENT_KILL / AGENTS_TERMINATE kill
    // the process, they remove the adapter from the lifecycle Map *before* the
    // OS delivers the async exit event. Without this guard, the delayed exit
    // overwrites the intentionally-set status ("idle"/"terminated") with
    // "error", and incorrectly marks the recovery tracker as errored.
    let thisSpawn: AgentAdapter | null = null;

    void ensureAdapter(
      {
        agent,
        ...(oauthToken !== undefined ? { oauthToken } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        userDataDir: app.getPath("userData"),
        dbPath: databasePath(),
        permissionsDir: getPermissionsDir(app.getPath("userData")),
        eventsDir,
        ...(memoryBlock !== undefined ? { memoryBlock } : {}),
        ...(telosBlock !== undefined ? { telosBlock } : {}),
        ...(projectContextBlock !== undefined ? { projectContextBlock } : {}),
        instructionsBlock,
      },
      {
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
              broadcast({ kind: "message-append", agentId: agent.id, message: m });
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
            collectedToolCalls.clear();
            router.onTurnComplete(agent.id);
            const memoryNearFull = agentMemoryNearFull(createMemoriesRepository(db), agent.id);
            const nudge = nudgeTracker.recordTurn(agent.id, { toolUseCount, memoryNearFull });
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
          } else if (ev.kind === "api-retry") {
            broadcast({
              kind: "error",
              agentId: agent.id,
              message: `API retry attempt ${String(ev.attempt)}: ${ev.error}`,
            });
          } else if (ev.kind === "rate-limited") {
            agents.updateStatus(agent.id, { status: "waiting", currentAction: "Rate limited" });
            broadcast({
              kind: "status-changed",
              agentId: agent.id,
              status: "waiting",
              updatedAt: Date.now(),
            });
            broadcast({
              kind: "rate-limited",
              agentId: agent.id,
              retryAfterSec: ev.retryAfterSec,
              message: ev.message,
            });
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
          const isCurrent = thisSpawn !== null && getAdapter(agent.id) === thisSpawn;
          removeAdapter(agent.id);
          if (!isCurrent) return;
          if (code !== 0) {
            recoveryTracker.markErrored(agent.id);
            agents.clearSessionId(agent.id);
          }
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
          currentActionDebouncer.cancel(agent.id);
          broadcast({ kind: "current-action-changed", agentId: agent.id, action: null });
        },
      },
    )
      .then((a) => {
        thisSpawn = a;
      })
      .catch(onError);
  };

  // M15 PR-A — wire the routines engine's bridge now that router and
  // ensureAgentRunner are in scope. The engine ticks immediately on start
  // so any due-on-boot routine fires from inside this call (catch-up).
  const routinesEngine = tryGetRoutinesEngine();
  if (routinesEngine !== null) {
    routinesEngine.start({
      getAgent: (id) => agents.getById(id),
      ensureAgentRunner: (agent) => ensureAgentRunner(agent),
      enqueue: (agentId, threadId, content, sender) =>
        router.enqueue(agentId, threadId, content, sender),
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
    getCeo: (companyId) => {
      const all = agents.listByCompany(companyId);
      return (
        all.find((a) => isCeoAgent(a) && a.status !== "terminated" && a.status !== "paused") ?? null
      );
    },
    ensureAgentRunner: (agent) => ensureAgentRunner(agent),
    enqueue: (agentId, threadId, content, sender) =>
      router.enqueue(agentId, threadId, content, sender),
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

  // Escalate any approvals that were routed to the CEO but never decided before
  // a restart (re-arming timers across restart is fragile; escalating is the safe side).
  try {
    const companyRows = db.prepare("SELECT id FROM companies").all() as { id: string }[];
    escalatePendingOnBoot(
      db,
      companyRows.map((c) => c.id),
    );
  } catch (err) {
    console.warn("[approvals] escalatePendingOnBoot failed", err);
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
  const restartIfRunning = (agentId: string, companyId: string): void => {
    const a = getAdapter(agentId);
    if (a !== undefined && a.isAlive()) {
      a.kill();
      removeAdapter(agentId);
    }
    agents.clearSessionId(agentId);
    agents.updateStatus(agentId, { status: "idle", currentAction: null });
    currentActionDebouncer.cancel(agentId);
    broadcast({ kind: "current-action-changed", agentId, action: null });
    broadcast({ kind: "roster-changed", companyId });
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
    (_e, payload: { agentId: string; content: string }): Promise<Message> => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");

      const userMessage = messages.append({
        companyId: agent.companyId,
        participants: ["user", agent.id],
        senderKind: "user",
        senderId: null,
        content: payload.content,
      });
      broadcast({ kind: "message-append", agentId: agent.id, message: userMessage });

      ensureAgentRunner(agent);
      enqueueOrPark(agent, router, userMessage.threadId, payload.content, {
        kind: "user",
        id: null,
        name: "User",
      });
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
      restartIfRunning(payload.agentId, agent.companyId);
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
      restartIfRunning(payload.agentId, agent.companyId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_SYSTEM_PROMPT,
    (_e, payload: { agentId: string; systemPrompt: string }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setSystemPrompt(payload.agentId, payload.systemPrompt);
      restartIfRunning(payload.agentId, agent.companyId);
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
      restartIfRunning(payload.agentId, agent.companyId);
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
      restartIfRunning(payload.agentId, agent.companyId);
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
      restartIfRunning(payload.agentId, agent.companyId);
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
    router.enqueue(agent.id, thread.id, "User requested manual run.", {
      kind: "user",
      id: null,
      name: "User",
    });
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
    router.enqueue(agent.id, thread.id, text, { kind: "user", id: null, name: "System" });
  };

  // M8.6 — Narrated execution. Enqueue a system-actor turn carrying the
  // [GOAL_EXECUTE_REQUEST] payload and return the thread id so executor can
  // persist it in goals.execution_state_json.
  const enqueueExecuteRequest = (ceoId: string, prompt: string): { threadId: string } => {
    const ceo = agents.getById(ceoId);
    if (ceo === null) throw new Error(`ceo ${ceoId} not found`);
    ensureAgentRunner(ceo);
    const thread = messages.ensureThread(ceo.companyId, ["user", ceo.id]);
    router.enqueue(ceo.id, thread.id, prompt, { kind: "user", id: null, name: "System" });
    return { threadId: thread.id };
  };

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

  // M8.6 — Boot recovery for narrated executions halted mid-loop (CEO
  // max-turns hit, app crash). Creates a goal_error inbox per stuck goal so
  // the user can choose to resume or rollback via /inbox CTAs.
  try {
    const halted = scanStuckNarrated(db);
    if (halted.length > 0) {
      console.log(`[goals/narrated] flagged ${halted.length} stuck narrated execution(s)`);
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
};
