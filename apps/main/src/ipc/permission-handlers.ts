import { ipcMain, BrowserWindow, app } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { IPC, type PermissionResolution, type PermissionRequest } from "@dashboard-agent/shared";
import { getPermissionsDir } from "../security/permissions-dir.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createApprovalsRepository } from "../approvals/repository.js";
import { broadcastInboxUpdate } from "./inbox-handlers.js";
import { tryGetRecorder } from "../activity/index.js";

export const broadcastPermissionRequest = (req: PermissionRequest): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.PERMISSION_REQUEST, req);
  }
};

export const registerPermissionHandlers = (db: Database.Database): void => {
  const inbox = createInboxRepository(db);
  const approvals = createApprovalsRepository(db);
  ipcMain.handle(
    IPC.PERMISSION_RESOLVE,
    (_e, payload: { toolUseId: string; resolution: PermissionResolution }): void => {
      const dir = getPermissionsDir(app.getPath("userData"));
      const filename = payload.resolution.behavior === "allow" ? "res.json" : "deny.json";
      const target = join(dir, `${payload.toolUseId}.${filename}`);
      console.log(
        `[m5/permission] resolve toolUseId=${payload.toolUseId} behavior=${payload.resolution.behavior} → writing ${target}`,
      );
      writeFileSync(target, JSON.stringify(payload.resolution));

      // Prefer new format: approval row + inbox pointer.
      const approval = approvals.findPendingByToolUseId(payload.toolUseId);
      if (approval !== null) {
        const updated = inbox.markReadByApprovalId(approval.id);
        if (updated !== null) {
          console.log(
            `[m5/permission] resolve markRead HIT (new format) itemId=${updated.id} approvalId=${approval.id}`,
          );
          broadcastInboxUpdate(updated.companyId);
          tryGetRecorder()?.recordActivity({
            companyId: updated.companyId,
            actor: { kind: "user" },
            action:
              payload.resolution.behavior === "allow" ? "approval.approved" : "approval.rejected",
            entityKind: "approval",
            entityId: approval.id,
            agentId: approval.agentId,
            payload: {
              approvalId: approval.id,
              note: payload.resolution.behavior === "deny" ? payload.resolution.message : undefined,
            },
          });
          return;
        }
      }

      // Legacy fallback: payload_json LIKE %toolUseId%.
      const updatedLegacy = inbox.markReadByToolUseId(payload.toolUseId);
      if (updatedLegacy !== null) {
        console.log(
          `[m5/permission] resolve markRead HIT (legacy format) itemId=${updatedLegacy.id}`,
        );
        broadcastInboxUpdate(updatedLegacy.companyId);
      } else {
        console.log(`[m5/permission] resolve markRead NO-HIT for ${payload.toolUseId}`);
      }
    },
  );
};
