// Cross-process bridge for CEO-side approval decisions.
//
// The CEO-side MCP tools (request_decision / decide_request) run in the MCP
// server CHILD process, where the approval-engine bridge and activity recorder
// are null (they are only initialized in the MAIN process). So those tools EMIT
// events via ctx.emit (a JSON file in EVENTS_DIR); the events-watcher in MAIN
// calls dispatchAgentEvent -> handleApprovalEvent, which does the actual
// routing, CEO wake, delivery, decision cards, timers, and audit here in MAIN
// where the bridge/recorder live.

import { createApprovalsRepository } from "./repository.js";
import {
  routeAndDispatch,
  escalateByCeoChoice,
  tryGetApprovalBridge,
  tryGetApprovalTimers,
} from "./index.js";
import { deliverManagerDecision } from "./deliver.js";
import { recomputeAgentTrust } from "../trust/engine.js";
import { tryGetRecorder } from "../activity/index.js";
import type { ManagerTopic } from "./types.js";

export type ApprovalEventInput = {
  kind: string;
  agentId: string;
  companyId: string;
  payload?: unknown;
};

// Coerce an unknown payload field to a string, defaulting when absent/non-string.
// Avoids @typescript-eslint/no-base-to-string on String(unknown) and keeps the
// JSON-decoded payload (which only ever carries primitives we set) safe.
const asStr = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);

export const handleApprovalEvent = (event: ApprovalEventInput): void => {
  const bridge = tryGetApprovalBridge();
  if (bridge === null) return;
  const p = (event.payload ?? {}) as Record<string, unknown>;

  if (event.kind === "approval.route") {
    const approvalId = asStr(p["approvalId"], "");
    if (approvalId === "") return;
    const route = routeAndDispatch({
      approvalId,
      companyId: event.companyId,
      kind: "manager_request",
      reason: "",
      requesterIsCeo: p["requesterIsCeo"] === true,
      requesterName: asStr(p["requesterName"], "Agente"),
      summary: asStr(p["summary"], ""),
      managerTopic: p["managerTopic"] as ManagerTopic,
      budgetOverLimit: p["budgetOverLimit"] === true,
    });
    tryGetRecorder()?.recordActivity({
      companyId: event.companyId,
      actor: { kind: "agent", id: event.agentId },
      action: "manager_request.created",
      entityKind: "approval",
      entityId: approvalId,
      agentId: event.agentId,
      payload: { approvalId, topic: asStr(p["managerTopic"], "other"), routedTo: route },
    });
    return;
  }

  if (event.kind === "approval.decided") {
    const approvalId = asStr(p["approvalId"], "");
    if (approvalId === "") return;
    const decision = p["decision"] === "approve" ? "approve" : "reject";
    const note = asStr(p["note"], "");
    const status = decision === "approve" ? "approved" : "rejected";

    if (p["kind"] === "tool_call") {
      // The requester's request_permission poll owns repo.decide for tool_call.
      // MAIN only cancels the escalation timer + drops the CEO decision card.
      tryGetApprovalTimers()?.cancel(approvalId);
      bridge.createCeoDecisionCard(approvalId, status);
      return;
    }

    // manager_request: MAIN owns the decision (no poll on the requester side).
    const repo = createApprovalsRepository(bridge.db);
    const apv = repo.getById(approvalId);
    if (apv === null || apv.status !== "pending") return;
    repo.decide(approvalId, status, event.agentId, note);
    if (apv.agentId !== null) {
      try {
        recomputeAgentTrust(bridge.db, apv.agentId);
      } catch (err) {
        console.warn("[approval] trust", err);
      }
    }
    deliverManagerDecision(bridge.db, apv, status, note);
    tryGetApprovalTimers()?.cancel(approvalId);
    bridge.createCeoDecisionCard(approvalId, status);
    tryGetRecorder()?.recordActivity({
      companyId: event.companyId,
      // The CEO (event.agentId) is the decider — more accurate than {kind:"user"}.
      actor: { kind: "agent", id: event.agentId },
      action: "manager_request.decided",
      entityKind: "approval",
      entityId: approvalId,
      agentId: apv.agentId,
      payload: { approvalId, decision: status, decidedBy: event.agentId },
    });
    if (status === "rejected") {
      // #6 (audit 2026-06-03): also emit a distinct approval.rejected activity so
      // the derivation dispatcher learns the org's preference — "what we don't
      // want". Without it, the manager_request.decided audit row never triggered
      // a job, and a whole class of rejections taught nothing. Scoped to the
      // requester (apv.agentId); the dispatcher drops null-agent rows.
      tryGetRecorder()?.recordActivity({
        companyId: event.companyId,
        actor: { kind: "agent", id: event.agentId },
        action: "approval.rejected",
        entityKind: "approval",
        entityId: approvalId,
        agentId: apv.agentId,
        payload: { approvalId, note },
      });
    }
    return;
  }

  if (event.kind === "approval.escalate") {
    const approvalId = asStr(p["approvalId"], "");
    if (approvalId !== "") escalateByCeoChoice(approvalId);
  }
};
