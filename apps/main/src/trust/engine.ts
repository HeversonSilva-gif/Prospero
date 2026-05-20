import type Database from "better-sqlite3";
import type { TrustTier } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { tryGetInbox } from "../inbox/index.js";
import { broadcastInboxUpdate } from "../ipc/inbox-handlers.js";
import { createTrustEventsRepository } from "./repository.js";
import { collectTrackRecord, type CollectTrackRecordOpts } from "./track-record.js";
import { evaluateTier } from "./evaluate.js";

export type RecomputeResult =
  | { applied: "none" }
  | { applied: "promoted"; newTier: TrustTier }
  | { applied: "demoted"; newTier: TrustTier }
  | { applied: "suggested" };

// M14 PR-A — reactive engine. Called from M13's verification gate after
// applyVerificationReport (and from the approval-decision call site). Idempotent:
// if the eligible tier matches the current tier, returns 'none'.
//
// Side effects:
//   - promote (novato→confiavel): writes trust_event, updates agents.trust_tier,
//                                 records activity. Visible but automatic.
//   - demote: same, plus reverts agents.mode to 'supervised' iff the demotion
//             is FROM autonomo. Other demotions leave `mode` alone (the user
//             still owns that field for non-autonomo agents).
//   - suggest (confiavel→autonomo only): writes trust_event 'promotion_suggested'
//             + inbox card + activity. Does NOT touch agents.trust_tier or
//             agents.mode — the user must explicitly approve via the inbox.
export const recomputeAgentTrust = (
  db: Database.Database,
  agentId: string,
  opts: CollectTrackRecordOpts = {},
): RecomputeResult => {
  const recorder = tryGetRecorder();
  const agentsRepo = createAgentsRepository(db, recorder);
  const agent = agentsRepo.getById(agentId);
  if (agent === null) return { applied: "none" };

  const record = collectTrackRecord(db, agentId, opts);
  const ev = evaluateTier(record, agent.trustTier);

  if (ev.eligible === ev.current) return { applied: "none" };

  const trustRepo = createTrustEventsRepository(db);

  // Promotion to autonomo is suggestion-only — user must approve.
  if (ev.eligible === "autonomo" && ev.current === "confiavel") {
    const inbox = tryGetInbox();
    const reason = `${record.verifiedOutcomes} outcomes verificados · ${(record.iscFirstPassRate * 100).toFixed(0)}% taxa de primeira`;
    const inboxItem = inbox?.create({
      companyId: agent.companyId,
      kind: "trust_promotion_suggested",
      actorId: agent.id,
      title: `Promover ${agent.name} para Autônomo?`,
      preview: `Histórico verificado: ${record.verifiedOutcomes} outcomes · ${(record.iscFirstPassRate * 100).toFixed(0)}% de primeira`,
      requiresAction: true,
      payloadJson: JSON.stringify({
        agentId: agent.id,
        fromTier: "confiavel",
        toTier: "autonomo",
      }),
    });
    if (inboxItem !== undefined) {
      try {
        broadcastInboxUpdate(agent.companyId);
      } catch (err) {
        console.warn("[trust] broadcastInboxUpdate failed", err);
      }
    }
    trustRepo.create({
      agentId: agent.id,
      kind: "promotion_suggested",
      fromTier: "confiavel",
      toTier: "autonomo",
      reason,
    });
    recorder?.recordActivity({
      companyId: agent.companyId,
      actor: { kind: "system", id: "trust-engine" },
      action: "trust.promotion_suggested",
      entityKind: "agent",
      entityId: agent.id,
      agentId: agent.id,
      payload: {
        fromTier: "confiavel",
        toTier: "autonomo",
        reason,
        inboxItemId: inboxItem?.id ?? "",
      },
    });
    return { applied: "suggested" };
  }

  // Any other movement is applied immediately.
  const fromTier = ev.current;
  const toTier = ev.eligible;
  const isDemotion = tierRank(toTier) < tierRank(fromTier);

  agentsRepo.setTrustTier(agent.id, toTier);

  // If leaving autonomo via demotion, revert mode to supervised. The user
  // retains manual control for all other transitions.
  if (isDemotion && fromTier === "autonomo") {
    agentsRepo.setMode(agent.id, "supervised");
  }

  const reason = isDemotion
    ? record.verificationFailures > 0
      ? `${record.verificationFailures} falha(s) de verificação no período`
      : "histórico abaixo do limite"
    : `${record.verifiedOutcomes} outcomes verificados sem falhas`;

  trustRepo.create({
    agentId: agent.id,
    kind: isDemotion ? "demoted" : "promoted",
    fromTier,
    toTier,
    reason,
  });

  recorder?.recordActivity({
    companyId: agent.companyId,
    actor: { kind: "system", id: "trust-engine" },
    action: isDemotion ? "trust.demoted" : "trust.promoted",
    entityKind: "agent",
    entityId: agent.id,
    agentId: agent.id,
    payload: { fromTier, toTier, reason },
  });

  return isDemotion
    ? { applied: "demoted", newTier: toTier }
    : { applied: "promoted", newTier: toTier };
};

const tierRank = (t: TrustTier): number => (t === "novato" ? 0 : t === "confiavel" ? 1 : 2);
