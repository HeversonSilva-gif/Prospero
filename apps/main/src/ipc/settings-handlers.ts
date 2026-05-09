import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type AppSettings } from "@dashboard-agent/shared";
import { createSettingsRepository } from "../settings/repository.js";

export const registerSettingsHandlers = (db: Database.Database): void => {
  const repo = createSettingsRepository(db);

  ipcMain.handle(IPC.SETTINGS_GET, (): AppSettings => repo.read());

  ipcMain.handle(IPC.SETTINGS_UPDATE, (_event, patch: unknown): AppSettings => {
    if (patch === null || typeof patch !== "object") return repo.read();
    repo.write(patch);
    return repo.read();
  });
};
