import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Company } from "@dashboard-agent/shared";
import { createCompaniesRepository } from "../companies/repository.js";
import { createDemoCompany } from "../companies/seed.js";

export const registerCompaniesHandlers = (db: Database.Database): void => {
  const repo = createCompaniesRepository(db);

  ipcMain.handle(IPC.COMPANY_LIST, (): Company[] => repo.list());

  ipcMain.handle(IPC.COMPANY_CREATE_DEMO, (): Company => createDemoCompany(db));

  ipcMain.handle(IPC.COMPANY_CREATE, (_e, payload: { name: string }): Company => {
    const trimmed = payload.name.trim();
    if (trimmed.length === 0) {
      throw new Error("[company:create] name is required");
    }
    return repo.create({ name: trimmed });
  });

  ipcMain.handle(IPC.COMPANY_DELETE, (_e, payload: { id: string }): { ok: true } => {
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      throw new Error("[company:delete] id is required");
    }
    repo.delete(payload.id);
    return { ok: true };
  });
};
