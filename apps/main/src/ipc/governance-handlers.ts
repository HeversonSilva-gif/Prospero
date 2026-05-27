import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import type { GovernanceConfig } from "@prospero/shared";
import { loadGovernanceConfig, saveGovernanceConfig } from "../approvals/governance-config.js";
import { isInQuietHours } from "../approvals/governance/quiet-hours.js";

export const handleGovernanceGet = (db: Database.Database, companyId: string): GovernanceConfig =>
  loadGovernanceConfig(db, companyId);

export const handleGovernanceUpdate = (
  db: Database.Database,
  companyId: string,
  config: GovernanceConfig,
): GovernanceConfig => {
  saveGovernanceConfig(db, companyId, config);
  return loadGovernanceConfig(db, companyId);
};

export const handleGovernanceIsQuietNow = (db: Database.Database, companyId: string): boolean => {
  const cfg = loadGovernanceConfig(db, companyId);
  return isInQuietHours(new Date(), cfg.quietHours);
};

export const registerGovernanceHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.GOVERNANCE_GET, (_e, companyId: string) => handleGovernanceGet(db, companyId));
  ipcMain.handle(IPC.GOVERNANCE_UPDATE, (_e, companyId: string, config: GovernanceConfig) =>
    handleGovernanceUpdate(db, companyId, config),
  );
  ipcMain.handle(IPC.GOVERNANCE_IS_QUIET, (_e, companyId: string) =>
    handleGovernanceIsQuietNow(db, companyId),
  );
};
