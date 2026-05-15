import { ipcMain, dialog, BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import { IPC, type AppSettings } from "@prospero/shared";
import { createSettingsRepository } from "../settings/repository.js";

export const registerSettingsHandlers = (db: Database.Database): void => {
  const repo = createSettingsRepository(db);

  ipcMain.handle(IPC.SETTINGS_GET, (): AppSettings => repo.read());

  ipcMain.handle(IPC.SETTINGS_UPDATE, (_event, patch: unknown): AppSettings => {
    if (patch === null || typeof patch !== "object") return repo.read();
    repo.write(patch);
    return repo.read();
  });

  ipcMain.handle(IPC.SETTINGS_PICK_WORKSPACE, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === null) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "Select Workspace Folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });
};
