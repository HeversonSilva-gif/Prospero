import { ipcMain, BrowserWindow, app } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { IPC, type PermissionResolution, type PermissionRequest } from "@dashboard-agent/shared";
import { getPermissionsDir } from "../security/permissions-dir.js";

export const broadcastPermissionRequest = (req: PermissionRequest): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.PERMISSION_REQUEST, req);
  }
};

export const registerPermissionHandlers = (): void => {
  ipcMain.handle(
    IPC.PERMISSION_RESOLVE,
    (_e, payload: { toolUseId: string; resolution: PermissionResolution }): void => {
      const dir = getPermissionsDir(app.getPath("userData"));
      const filename = payload.resolution.behavior === "allow" ? "res.json" : "deny.json";
      writeFileSync(
        join(dir, `${payload.toolUseId}.${filename}`),
        JSON.stringify(payload.resolution),
      );
    },
  );
};
