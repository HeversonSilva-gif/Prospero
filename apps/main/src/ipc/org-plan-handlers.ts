import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type ApplyOrgPlanResult, type OrgPlan } from "@prospero/shared";
import { createOrgPlansRepository } from "../agents/org-plans-repository.js";
import { applyOrgPlan } from "../agents/apply-org-plan.js";
import { createSettingsRepository } from "../settings/repository.js";

export const registerOrgPlanHandlers = (db: Database.Database): void => {
  const repo = createOrgPlansRepository(db);

  ipcMain.handle(IPC.ORG_PLAN_GET_CURRENT, (): OrgPlan | null => {
    const companyId = createSettingsRepository(db).read().activeCompanyId;
    if (companyId === null) return null;
    return repo.getCurrentForCompany(companyId);
  });

  ipcMain.handle(
    IPC.ORG_PLAN_APPROVE,
    (
      _e,
      payload: {
        orgPlanId: string;
        includeRoleIndexes?: number[];
        includeAgentIndexes?: number[];
      },
    ): ApplyOrgPlanResult => {
      return applyOrgPlan(db, app.getPath("userData"), payload.orgPlanId, {
        ...(payload.includeRoleIndexes !== undefined
          ? { includeRoleIndexes: new Set(payload.includeRoleIndexes) }
          : {}),
        ...(payload.includeAgentIndexes !== undefined
          ? { includeAgentIndexes: new Set(payload.includeAgentIndexes) }
          : {}),
      });
    },
  );

  ipcMain.handle(
    IPC.ORG_PLAN_REJECT,
    (_e, payload: { orgPlanId: string; reason?: string }): { ok: true } => {
      repo.markRejected(payload.orgPlanId, payload.reason ?? null);
      return { ok: true };
    },
  );
};
