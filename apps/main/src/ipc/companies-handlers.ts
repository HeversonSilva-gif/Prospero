import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Company } from "@prospero/shared";
import { createCompaniesRepository } from "../companies/repository.js";
import { createDemoCompany } from "../companies/seed.js";
import { exportCompany, type CompanyExportV1 } from "../companies/export.js";
import { importCompany } from "../companies/import.js";
import type { ImportSummary } from "../companies/import-schema.js";

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

  ipcMain.handle(IPC.COMPANY_EXPORT, (_e, payload: { id: string }): CompanyExportV1 => {
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      throw new Error("[company:export] id is required");
    }
    return exportCompany(db, payload.id, app.getPath("userData"));
  });

  ipcMain.handle(IPC.COMPANY_IMPORT, (_e, payload: { snapshot: unknown }): ImportSummary => {
    if (payload === null || typeof payload !== "object" || !("snapshot" in payload)) {
      throw new Error("[company:import] snapshot payload is required");
    }
    return importCompany(db, payload.snapshot, app.getPath("userData"));
  });
};
