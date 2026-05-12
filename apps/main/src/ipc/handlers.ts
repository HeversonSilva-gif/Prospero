import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@dashboard-agent/shared";
import { registerSettingsHandlers } from "./settings-handlers.js";
import { registerAuthHandlers } from "./auth-handlers.js";
import { registerCompaniesHandlers } from "./companies-handlers.js";
import { registerMessagesHandlers } from "./messages-handlers.js";
import { registerOrchestratorHandlers } from "./orchestrator-handlers.js";
import { registerPermissionHandlers } from "./permission-handlers.js";
import { registerInboxHandlers } from "./inbox-handlers.js";
import { registerProjectsHandlers } from "./projects-handlers.js";
import { registerIssuesHandlers } from "./issues-handlers.js";
import { registerRolesHandlers } from "./roles-handlers.js";
import { registerActivityHandlers } from "./activity-handlers.js";

export const registerIpcHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.PING, () => "pong");
  registerSettingsHandlers(db);
  registerAuthHandlers(db);
  registerCompaniesHandlers(db);
  registerMessagesHandlers(db);
  registerOrchestratorHandlers(db);
  registerPermissionHandlers(db);
  registerInboxHandlers(db);
  registerProjectsHandlers(db);
  registerIssuesHandlers(db);
  registerRolesHandlers(db);
  registerActivityHandlers(db);
};
