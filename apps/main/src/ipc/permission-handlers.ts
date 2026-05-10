import { ipcMain, BrowserWindow, app } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { IPC, type PermissionResolution, type PermissionRequest } from "@dashboard-agent/shared";
import { getPermissionsDir } from "../security/permissions-dir.js";
import { createInboxRepository } from "../inbox/repository.js";
import { broadcastInboxUpdate } from "./inbox-handlers.js";

export const broadcastPermissionRequest = (req: PermissionRequest): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.PERMISSION_REQUEST, req);
  }
};

export const registerPermissionHandlers = (db: Database.Database): void => {
  const inbox = createInboxRepository(db);
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
      // Mark the matching inbox approval as read directly here — avoids racing with
      // the file-watcher's onResolved callback (chokidar's awaitWriteFinish may miss
      // the event if the MCP child unlinks the file before stabilization).
      const updated = inbox.markReadByToolUseId(payload.toolUseId);
      if (updated !== null) {
        console.log(
          `[m5/permission] resolve markRead HIT itemId=${updated.id} companyId=${updated.companyId} (${payload.resolution.behavior})`,
        );
        broadcastInboxUpdate(updated.companyId);
      } else {
        console.log(`[m5/permission] resolve markRead NO-HIT for ${payload.toolUseId}`);
      }
    },
  );
};
