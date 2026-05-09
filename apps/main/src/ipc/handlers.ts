import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@dashboard-agent/shared";
import { registerSettingsHandlers } from "./settings-handlers.js";
import { registerAuthHandlers } from "./auth-handlers.js";

export const registerIpcHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.PING, () => "pong");
  registerSettingsHandlers(db);
  registerAuthHandlers(db);
};
