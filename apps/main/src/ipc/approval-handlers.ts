import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import { createApprovalsRepository } from "../approvals/repository.js";
import { tryGetApprovalBridge } from "../approvals/index.js";
import { deliverManagerDecision } from "../approvals/deliver.js";
import { recomputeAgentTrust } from "../trust/engine.js";
import { tryGetRecorder } from "../activity/index.js";

export const registerApprovalHandlers = (db: Database.Database): void => {
  ipcMain.handle(
    IPC.MANAGER_REQUEST_DECIDE,
    (
      _e,
      payload: { approvalId: string; decision: "approved" | "rejected"; note?: string },
    ): void => {
      const repo = createApprovalsRepository(db);
      const apv = repo.getById(payload.approvalId);
      if (apv === null || apv.status !== "pending" || apv.kind !== "manager_request") return;
      repo.decide(apv.id, payload.decision, "user", payload.note);
      if (apv.agentId !== null) {
        try {
          recomputeAgentTrust(db, apv.agentId);
        } catch {
          /* best-effort: a trust failure must not break the decision */
        }
      }
      deliverManagerDecision(db, apv, payload.decision, payload.note ?? "");
      const companyId =
        apv.agentId !== null
          ? (tryGetApprovalBridge()?.getAgent(apv.agentId)?.companyId ?? "")
          : "";
      tryGetRecorder()?.recordActivity({
        companyId,
        actor: { kind: "user" },
        action: "manager_request.decided",
        entityKind: "approval",
        entityId: apv.id,
        agentId: apv.agentId,
        payload: { approvalId: apv.id, decision: payload.decision, decidedBy: "user" },
      });
    },
  );
};
