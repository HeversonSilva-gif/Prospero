import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Company } from "@dashboard-agent/shared";
import { createCompaniesRepository } from "../companies/repository.js";
import { createDemoCompany } from "../companies/seed.js";

export const registerCompaniesHandlers = (db: Database.Database): void => {
  const repo = createCompaniesRepository(db);
  ipcMain.handle(IPC.COMPANY_LIST, (): Company[] => repo.list());
  ipcMain.handle(IPC.COMPANY_CREATE_DEMO, (): Company => createDemoCompany(db));
};
