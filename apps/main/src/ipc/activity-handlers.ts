import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type ActivityEventRow } from "@dashboard-agent/shared";
import { createActivityRepository, type ActivityQueryParams } from "../activity/repository.js";

export const registerActivityHandlers = (db: Database.Database): void => {
  const repo = createActivityRepository(db);
  ipcMain.handle(IPC.ACTIVITY_QUERY, (_e, params: ActivityQueryParams): ActivityEventRow[] =>
    repo.query(params),
  );
};
