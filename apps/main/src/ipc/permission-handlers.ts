import { ipcMain, BrowserWindow, app } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { IPC, type PermissionResolution, type PermissionRequest } from "@dashboard-agent/shared";
import { getPermissionsDir } from "../security/permissions-dir.js";

export const broadcastPermissionRequest = (req: PermissionRequest): void => {
  const wins = BrowserWindow.getAllWindows();
  console.log(
    `[m5/permission] broadcast PERMISSION_REQUEST toolUseId=${req.toolUseId} agentId=${req.agentId} wins=${String(wins.length)}`,
  );
  for (const win of wins) {
    win.webContents.send(IPC.PERMISSION_REQUEST, req);
  }
};

export const registerPermissionHandlers = (): void => {
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
    },
  );
};
