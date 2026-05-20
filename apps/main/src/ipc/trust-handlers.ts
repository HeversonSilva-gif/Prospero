import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type TrustEvent, type TrustTier } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import { createTrustEventsRepository } from "../trust/repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { broadcastInboxUpdate } from "./inbox-handlers.js";

// M14 PR-A — IPC bridge for the trust ladder. Two channels:
//   - trust:get-history(agentId) → TrustEvent[]
//   - trust:approve-promotion(inboxItemId) → applies confiavel→autonomo
// `trust:approve-promotion` is called from the inbox card; it flips the
// agent's tier, sets mode=auto, marks the card resolved, and audits.

export type TrustHandlersDeps = { db: Database.Database };

export type TrustHandlers = {
  getHistory(args: { agentId: string }): TrustEvent[];
  approvePromotion(args: { inboxItemId: string }): { ok: true };
};

export const trustHandlers = (deps: TrustHandlersDeps): TrustHandlers => {
  const recorder = tryGetRecorder();
  const trustRepo = createTrustEventsRepository(deps.db);
  const agentsRepo = createAgentsRepository(deps.db, recorder);

  return {
    getHistory({ agentId }) {
      return trustRepo.listByAgent(agentId);
    },
    approvePromotion({ inboxItemId }) {
      const item = deps.db
        .prepare("SELECT id, kind, company_id, payload_json FROM inbox_items WHERE id = ?")
        .get(inboxItemId) as
        | { id: string; kind: string; company_id: string; payload_json: string | null }
        | undefined;
      if (item === undefined) {
        throw new Error(`inbox item ${inboxItemId} not found`);
      }
      if (item.kind !== "trust_promotion_suggested") {
        throw new Error(
          `inbox item ${inboxItemId} is not a trust promotion suggestion (kind=${item.kind})`,
        );
      }
      const payload = JSON.parse(item.payload_json ?? "{}") as {
        agentId: string;
        fromTier: TrustTier;
        toTier: TrustTier;
      };

      agentsRepo.setTrustTier(payload.agentId, payload.toTier);
      if (payload.toTier === "autonomo") {
        agentsRepo.setMode(payload.agentId, "auto");
      }

      trustRepo.create({
        agentId: payload.agentId,
        kind: "promoted",
        fromTier: payload.fromTier,
        toTier: payload.toTier,
        reason: "aprovado pelo usuário",
      });

      recorder?.recordActivity({
        companyId: item.company_id,
        actor: { kind: "user" },
        action: "trust.promoted",
        entityKind: "agent",
        entityId: payload.agentId,
        agentId: payload.agentId,
        payload: {
          fromTier: payload.fromTier,
          toTier: payload.toTier,
          reason: "aprovado pelo usuário",
        },
      });

      // Mark the inbox card resolved + broadcast so the badge clears.
      deps.db
        .prepare("UPDATE inbox_items SET read_at = ? WHERE id = ?")
        .run(Date.now(), inboxItemId);
      try {
        broadcastInboxUpdate(item.company_id);
      } catch (err) {
        console.warn("[trust] broadcastInboxUpdate failed", err);
      }

      return { ok: true };
    },
  };
};

export const registerTrustHandlers = (db: Database.Database): void => {
  const h = trustHandlers({ db });
  ipcMain.handle(IPC.TRUST_GET_HISTORY, (_e, args: { agentId: string }) => h.getHistory(args));
  ipcMain.handle(IPC.TRUST_APPROVE_PROMOTION, (_e, args: { inboxItemId: string }) =>
    h.approvePromotion(args),
  );
};
