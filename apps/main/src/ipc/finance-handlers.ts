import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type FinanceSummary } from "@prospero/shared";
import { computeFinanceSummary } from "../connections/finance-summary.js";

// IPC bridge for the Financeiro screen (v0.2.8). Read-only: returns the finance panorama
// for a company over a window (default 30 days). All computation lives in the pure
// computeFinanceSummary; this just supplies `now` and the window.
export const registerFinanceHandlers = (db: Database.Database): void => {
  ipcMain.handle(
    IPC.FINANCE_SUMMARY,
    (_e, payload: { companyId: string; days?: number }): FinanceSummary => {
      const days = payload.days && payload.days > 0 ? payload.days : 30;
      return computeFinanceSummary(db, payload.companyId, {
        now: Date.now(),
        windowMs: days * 24 * 60 * 60_000,
      });
    },
  );
};
