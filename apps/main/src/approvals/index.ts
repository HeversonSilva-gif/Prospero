import type Database from "better-sqlite3";
import type { Agent } from "@prospero/shared";
import type { Sender } from "../orchestrator/router.js";
import type { RecordActivityInput } from "../activity/recorder.js";
import { createApprovalsRepository } from "./repository.js";
import { routeApprovalRequest } from "./routing.js";
import { wakeCeoForApproval } from "./ceo-wake.js";
import { createEscalationTimers, type EscalationTimers } from "./escalation-timer.js";
import { applyGovernance } from "./governance/index.js";
import { loadGovernanceConfig } from "./governance-config.js";
import { createCoalescer, type Coalescer, type FlushPayload } from "./coalescer.js";
import { isDestructiveApproval } from "./destructive.js";

export const CEO_DECISION_TIMEOUT_MS = 10 * 60_000;

export interface ApprovalEngineBridge {
  db: Database.Database;
  getAgent: (id: string) => Agent | null;
  getCeo: (companyId: string) => Agent | null;
  ensureAgentRunner: (agent: Agent) => void;
  enqueue: (agentId: string, threadId: string, content: string, sender: Sender) => void;
  primaryThreadId: (agentId: string) => string;
  recordActivity: (input: RecordActivityInput) => void;
  createHumanCard: (approvalId: string) => void;
  createCeoDecisionCard: (approvalId: string, decision: "approved" | "rejected") => void;
}

let bridge: ApprovalEngineBridge | null = null;
let timers: EscalationTimers | null = null;
let coalescer: Coalescer | null = null;
const COALESCER_WINDOW_MS = 60_000;

// Per-approval bounce timers keyed by approvalId.
const perApprovalBounceTimers = new Map<string, NodeJS.Timeout>();

const armBounceFor = (approvalId: string, ttlMs: number): void => {
  const prev = perApprovalBounceTimers.get(approvalId);
  if (prev !== undefined) clearTimeout(prev);
  const h = setTimeout(() => {
    perApprovalBounceTimers.delete(approvalId);
    bounceToCEO(approvalId);
  }, ttlMs);
  perApprovalBounceTimers.set(approvalId, h);
};

const cancelBounceFor = (approvalId: string): void => {
  const h = perApprovalBounceTimers.get(approvalId);
  if (h !== undefined) {
    clearTimeout(h);
    perApprovalBounceTimers.delete(approvalId);
  }
};

const bounceToCEO = (approvalId: string): void => {
  if (bridge === null) return;
  const repo = createApprovalsRepository(bridge.db);
  const apv = repo.getById(approvalId);
  if (apv === null || apv.status !== "pending") {
    cancelBounceFor(approvalId);
    return;
  }
  if (apv.bounceCount >= 1) {
    // Already bounced once — default-deny final.
    repo.decide(approvalId, "rejected", "system", "ceo+human both timeout");
    const companyId = apv.agentId !== null ? (bridge.getAgent(apv.agentId)?.companyId ?? "") : "";
    if (companyId !== "") {
      bridge.recordActivity({
        companyId,
        actor: { kind: "system" },
        action: "approval.default_denied_final",
        entityKind: "approval",
        entityId: approvalId,
        agentId: apv.agentId,
        payload: { approvalId },
      });
    }
    return;
  }
  // First bounce — increment, re-route to CEO with the bounced flag.
  repo.incrementBounceCount(approvalId);
  repo.setRouted(approvalId, "ceo");
  const companyId = apv.agentId !== null ? (bridge.getAgent(apv.agentId)?.companyId ?? "") : "";
  if (companyId !== "") {
    bridge.recordActivity({
      companyId,
      actor: { kind: "system" },
      action: "approval.bounced_to_ceo",
      entityKind: "approval",
      entityId: approvalId,
      agentId: apv.agentId,
      payload: { approvalId, reason: "timeout" },
    });
    const requester =
      apv.agentId !== null ? (bridge.getAgent(apv.agentId)?.name ?? "unknown") : "unknown";
    wakeCeoForApproval(
      {
        approvalId,
        companyId,
        requesterName: requester,
        summary: apv.payloadJson,
        kind: apv.kind,
      },
      {
        getCeo: bridge.getCeo,
        ensureAgentRunner: bridge.ensureAgentRunner,
        enqueue: bridge.enqueue,
        primaryThreadId: bridge.primaryThreadId,
        recordActivity: bridge.recordActivity,
      },
      { bouncedFromHuman: true },
    );
    timers?.arm(approvalId); // rearm escalation timer for 2nd timeout
  }
};

const escalateToHuman = (
  approvalId: string,
  reason: "ceo_choice" | "timeout" | "rule" | "restart" | "no_ceo",
): void => {
  if (bridge === null) return;
  const repo = createApprovalsRepository(bridge.db);
  const apv = repo.getById(approvalId);
  if (apv === null || apv.status !== "pending") return; // race: already resolved

  // M20: if approval was already bounced from human → CEO and CEO timed out,
  // default-deny instead of bouncing back to human (which would loop).
  if (apv.bounceCount >= 1 && reason === "timeout") {
    repo.decide(approvalId, "rejected", "system", "ceo timeout after bounce");
    const companyId = apv.agentId !== null ? (bridge.getAgent(apv.agentId)?.companyId ?? "") : "";
    if (companyId !== "") {
      bridge.recordActivity({
        companyId,
        actor: { kind: "system" },
        action: "approval.default_denied_final",
        entityKind: "approval",
        entityId: approvalId,
        agentId: apv.agentId,
        payload: { approvalId },
      });
    }
    return;
  }

  repo.setRouted(approvalId, "user");
  repo.setEscalated(approvalId);
  timers?.cancel(approvalId);
  cancelBounceFor(approvalId);
  bridge.createHumanCard(approvalId);
  const companyId = apv.agentId !== null ? (bridge.getAgent(apv.agentId)?.companyId ?? "") : "";
  if (companyId !== "") {
    bridge.recordActivity({
      companyId,
      actor: { kind: "system" },
      action: "approval.escalated",
      entityKind: "approval",
      entityId: approvalId,
      agentId: apv.agentId,
      payload: { approvalId, reason },
    });
  }
};

const onCoalescedFlush = (payload: FlushPayload): void => {
  if (bridge === null) return;
  const repo = createApprovalsRepository(bridge.db);

  // Resolve approvals from the DB (the coalescer holds only ids — the DB
  // is the source of truth for status/agent/payload).
  const approvals = payload.approvalIds
    .map((id) => repo.getById(id))
    .filter(
      (a): a is NonNullable<typeof a> =>
        a !== null && a.status === "pending" && a.routedTo === "ceo",
    );

  if (approvals.length === 0) return;

  const head = approvals[0];
  if (head === undefined) return;

  // Mark followers as coalesced_with the head — accountability record so
  // the UI can later show "decided as part of batch X".
  for (let i = 1; i < approvals.length; i++) {
    const follower = approvals[i];
    if (follower !== undefined) {
      repo.setCoalescedWith(follower.id, head.id);
    }
  }

  // Build the wake message: one section per approval with the inputs the
  // CEO needs to decide. Conservative — show full payload (CEO will skim).
  const lines: string[] = [];
  lines.push(
    `Você tem ${approvals.length.toString()} ${approvals.length === 1 ? "decisão pendente" : "decisões pendentes"} para revisar.`,
  );
  if (approvals.length > 1) {
    lines.push(
      "Use a ferramenta `decide_batch` para decidir várias em uma só chamada (mais barato em tokens), ou `decide_request` individualmente.",
    );
  }
  lines.push("");
  lines.push("Pendentes:");
  for (let i = 0; i < approvals.length; i++) {
    const a = approvals[i];
    if (a === undefined) continue;
    lines.push(`${(i + 1).toString()}. ${a.id} — kind=${a.kind} requester=${a.agentId ?? "?"}`);
    lines.push(`   payload: ${a.payloadJson}`);
  }
  const summary = lines.join("\n");

  // Determine the requesterName for the wake — for batches we lean on
  // the head's requester to keep the existing wake signature happy.
  const requesterName =
    head.agentId !== null ? (bridge.getAgent(head.agentId)?.name ?? "unknown") : "unknown";

  wakeCeoForApproval(
    {
      approvalId: head.id,
      companyId: payload.companyId,
      requesterName,
      summary,
      kind: head.kind,
    },
    {
      getCeo: bridge.getCeo,
      ensureAgentRunner: bridge.ensureAgentRunner,
      enqueue: bridge.enqueue,
      primaryThreadId: bridge.primaryThreadId,
      recordActivity: bridge.recordActivity,
    },
  );

  // Arm an escalation timer for EVERY approval in the batch, not just the head.
  // The wake names only head.id, so a CEO that decides just the head would leave
  // the followers sitting pending with no timer/bounce — the requesting workers
  // then hang until restart. Each follower escalates on its own timeout;
  // deciding it cancels its timer. Audit 2026-06-03 Facet 2 C2.
  for (const a of approvals) {
    timers?.arm(a.id);
  }
};

export const setApprovalEngineBridge = (b: ApprovalEngineBridge): void => {
  bridge = b;
  timers = createEscalationTimers({
    timeoutMs: CEO_DECISION_TIMEOUT_MS,
    onEscalate: (id) => escalateToHuman(id, "timeout"),
  });
  coalescer = createCoalescer({
    windowMs: COALESCER_WINDOW_MS,
    onFlush: onCoalescedFlush,
  });
};

export const tryGetApprovalBridge = (): ApprovalEngineBridge | null => bridge;
export const tryGetApprovalTimers = (): EscalationTimers | null => timers;

// Decide CEO x humano para uma approval JA CRIADA, e dispara o lado escolhido.
export const routeAndDispatch = (input: {
  approvalId: string;
  companyId: string;
  kind: Parameters<typeof routeApprovalRequest>[0]["kind"];
  reason: string;
  requesterIsCeo: boolean;
  requesterName: string;
  summary: string;
  managerTopic?: Parameters<typeof routeApprovalRequest>[0]["managerTopic"];
  budgetOverLimit?: boolean;
  toolName?: string;
  estimatedSpendUsd?: number;
}): "ceo" | "user" => {
  if (bridge === null) return "user";
  const repo = createApprovalsRepository(bridge.db);

  // Guard: skip stale or duplicate events — only route an approval that is still
  // pending and has not been routed yet. Prevents CEO double-wake when the same
  // approval.route event fires more than once (e.g. file-watcher dedup race or
  // a re-queued boot event), or when decide_request's immediate repo.decide()
  // already resolved the row before the event reaches MAIN.
  const currentApv = repo.getById(input.approvalId);
  if (currentApv === null || currentApv.status !== "pending" || currentApv.routedTo !== null) {
    return currentApv?.routedTo === "ceo" ? "ceo" : "user";
  }

  const cfg = loadGovernanceConfig(bridge.db, input.companyId);
  const verdict = applyGovernance(
    {
      kind: input.kind,
      ...(input.toolName !== undefined ? { toolName: input.toolName } : {}),
      ...(input.estimatedSpendUsd !== undefined
        ? { estimatedSpendUsd: input.estimatedSpendUsd }
        : {}),
      ...(input.managerTopic !== undefined ? { managerTopic: input.managerTopic } : {}),
      ...(input.budgetOverLimit !== undefined ? { budgetOverLimit: input.budgetOverLimit } : {}),
    },
    cfg,
    new Date(),
  );

  if (verdict.kind === "auto-approve") {
    repo.decide(input.approvalId, "approved", "system", `auto-policy: ${verdict.reason}`);
    bridge.recordActivity({
      companyId: input.companyId,
      actor: { kind: "system" },
      action: "governance.auto_approved",
      entityKind: "approval",
      entityId: input.approvalId,
      agentId: currentApv.agentId,
      payload: { approvalId: input.approvalId, policyId: verdict.reason },
    });
    return "ceo";
  }

  const ceoAvailable = bridge.getCeo(input.companyId) !== null;
  const route = routeApprovalRequest({
    kind: input.kind,
    reason: input.reason,
    requesterIsCeo: input.requesterIsCeo,
    ceoAvailable,
    relaxedFires: verdict.relaxedFires,
    relaxedBudgets: verdict.relaxedBudgets,
    ...(input.managerTopic !== undefined ? { managerTopic: input.managerTopic } : {}),
    ...(input.budgetOverLimit !== undefined ? { budgetOverLimit: input.budgetOverLimit } : {}),
  });

  if (route === "user") {
    repo.setRouted(input.approvalId, "user");
    bridge.createHumanCard(input.approvalId);
    const ttlMs = cfg.policies.bouncedToCeoTtlHours * 60 * 60_000;
    armBounceFor(input.approvalId, ttlMs);
    return "user";
  }

  // route === "ceo"
  repo.setRouted(input.approvalId, "ceo");

  // Coalescing window (piece #5): instead of waking the CEO once per
  // approval, queue the approval. The coalescer waits up to
  // COALESCER_WINDOW_MS (60s) collecting more approvals, then wakes the
  // CEO ONCE with a batch. A destructive approval (Bash / Write / fire /
  // budget) collapses the window — wake immediately.
  if (coalescer === null) {
    // Defensive: bridge unset means something is misconfigured. Fall back
    // to the legacy single-approval wake path so the system stays usable.
    const woke = wakeCeoForApproval(
      {
        approvalId: input.approvalId,
        companyId: input.companyId,
        requesterName: input.requesterName,
        summary: input.summary,
        kind: input.kind,
      },
      {
        getCeo: bridge.getCeo,
        ensureAgentRunner: bridge.ensureAgentRunner,
        enqueue: bridge.enqueue,
        primaryThreadId: bridge.primaryThreadId,
        recordActivity: bridge.recordActivity,
      },
    );
    if (!woke) {
      escalateToHuman(input.approvalId, "no_ceo");
      return "user";
    }
    timers?.arm(input.approvalId);
    return "ceo";
  }

  const destructive =
    input.kind === "tool_call" || input.kind === "manager_request"
      ? isDestructiveApproval({
          kind: input.kind,
          payloadJson: currentApv.payloadJson,
        })
      : false;
  coalescer.enqueue({
    companyId: input.companyId,
    approvalId: input.approvalId,
    destructive,
  });
  return "ceo";
};

export const escalatePendingOnBoot = (db: Database.Database, companyIds: string[]): void => {
  const repo = createApprovalsRepository(db);
  for (const cid of companyIds) {
    for (const apv of repo.listPendingRoutedToCeo(cid)) {
      escalateToHuman(apv.id, "restart");
    }
  }
};

export const armBouncesOnBoot = (db: Database.Database, companyIds: string[]): void => {
  const now = Date.now();
  for (const cid of companyIds) {
    const cfg = loadGovernanceConfig(db, cid);
    const ttlMs = cfg.policies.bouncedToCeoTtlHours * 60 * 60_000;
    const repo = createApprovalsRepository(db);
    for (const apv of repo.listPendingRoutedToUserForBounce(now - ttlMs)) {
      bounceToCEO(apv.id);
    }
  }
};

export const escalateByCeoChoice = (approvalId: string): void =>
  escalateToHuman(approvalId, "ceo_choice");

// Test-only: reset module state between tests.
export const __resetApprovalEngine = (): void => {
  timers?.clearAll();
  coalescer?.clearAll();
  for (const h of perApprovalBounceTimers.values()) clearTimeout(h);
  perApprovalBounceTimers.clear();
  bridge = null;
  timers = null;
  coalescer = null;
};
