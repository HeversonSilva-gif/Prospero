import type Database from "better-sqlite3";
import type { Agent } from "@prospero/shared";
import type { Sender } from "../orchestrator/router.js";
import type { RecordActivityInput } from "../activity/recorder.js";
import { createApprovalsRepository } from "./repository.js";
import { routeApprovalRequest } from "./routing.js";
import { wakeCeoForApproval } from "./ceo-wake.js";
import { createEscalationTimers, type EscalationTimers } from "./escalation-timer.js";

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

const escalateToHuman = (
  approvalId: string,
  reason: "ceo_choice" | "timeout" | "rule" | "restart" | "no_ceo",
): void => {
  if (bridge === null) return;
  const repo = createApprovalsRepository(bridge.db);
  const apv = repo.getById(approvalId);
  if (apv === null || apv.status !== "pending") return; // race: already resolved
  repo.setRouted(approvalId, "user");
  repo.setEscalated(approvalId);
  timers?.cancel(approvalId);
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

export const setApprovalEngineBridge = (b: ApprovalEngineBridge): void => {
  bridge = b;
  timers = createEscalationTimers({
    timeoutMs: CEO_DECISION_TIMEOUT_MS,
    onEscalate: (id) => escalateToHuman(id, "timeout"),
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

  const ceoAvailable = bridge.getCeo(input.companyId) !== null;
  const route = routeApprovalRequest({
    kind: input.kind,
    reason: input.reason,
    requesterIsCeo: input.requesterIsCeo,
    ceoAvailable,
    ...(input.managerTopic !== undefined ? { managerTopic: input.managerTopic } : {}),
    ...(input.budgetOverLimit !== undefined ? { budgetOverLimit: input.budgetOverLimit } : {}),
  });
  if (route === "user") {
    repo.setRouted(input.approvalId, "user");
    bridge.createHumanCard(input.approvalId);
    return "user";
  }
  repo.setRouted(input.approvalId, "ceo");
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
};

export const escalatePendingOnBoot = (db: Database.Database, companyIds: string[]): void => {
  const repo = createApprovalsRepository(db);
  for (const cid of companyIds) {
    for (const apv of repo.listPendingRoutedToCeo(cid)) {
      escalateToHuman(apv.id, "restart");
    }
  }
};

export const escalateByCeoChoice = (approvalId: string): void =>
  escalateToHuman(approvalId, "ceo_choice");

// Test-only: reset module state between tests.
export const __resetApprovalEngine = (): void => {
  timers?.clearAll();
  bridge = null;
  timers = null;
};
