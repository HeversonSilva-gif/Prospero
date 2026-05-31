import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type BusinessPlan } from "@prospero/shared";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createSettingsRepository } from "../settings/repository.js";
import { applyBusinessPlan } from "../agents/apply-business-plan.js";
import { businessPlanToTelosAnswers } from "../agents/genesis/business-plan-to-telos.js";
import { synthesizeTelos } from "../companies/telos-synthesis.js";
import { writeTelos as writeTelosFile } from "../companies/telos-store.js";
import { companyTelosPath } from "../companies/telos-dir.js";
import type { RunDerivationResult } from "../derivation/runner.js";
import { runDerivation, defaultRunProcess } from "../derivation/runner.js";
import { buildAuthEnv } from "../derivation/index.js";

export type ApproveBusinessPlanDeps = {
  // Must return RunDerivationResult so it is assignable to synthesizeTelos's deps.
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
  env: Record<string, string>;
  writeTelos: (userDataDir: string, companyId: string, body: string) => void;
  setTelosPath: (companyId: string, telosPath: string) => void;
};

// Testable core: apply the plan synchronously, then synthesize the TELOS
// (fail-soft — approval already succeeded; a TELOS failure must not block genesis).
export const approveBusinessPlan = async (
  db: Database.Database,
  userDataDir: string,
  businessPlanId: string,
  deps: ApproveBusinessPlanDeps,
): Promise<{ ok: boolean; error?: string }> => {
  const repo = createBusinessPlansRepository(db);
  const plan = repo.getById(businessPlanId);
  const applied = applyBusinessPlan(db, businessPlanId);
  if (!applied.ok) return { ok: false, error: applied.error };
  if (plan !== null) {
    try {
      const draft = await synthesizeTelosWith(deps, db, plan);
      if (draft !== null) {
        deps.writeTelos(userDataDir, plan.companyId, draft);
        deps.setTelosPath(plan.companyId, companyTelosPath(userDataDir, plan.companyId));
      }
    } catch {
      /* fail-soft: identity + rename already applied */
    }
  }
  return { ok: true };
};

const synthesizeTelosWith = async (
  deps: ApproveBusinessPlanDeps,
  db: Database.Database,
  plan: BusinessPlan,
): Promise<string | null> => {
  const result = await synthesizeTelos(
    { db, runDerivation: deps.runDerivation },
    { answers: businessPlanToTelosAnswers(plan), env: deps.env, companyId: plan.companyId },
  );
  return result.telos;
};

export const registerBusinessPlanHandlers = (db: Database.Database): void => {
  const repo = createBusinessPlansRepository(db);

  ipcMain.handle(IPC.BUSINESS_PLAN_GET_CURRENT, (): BusinessPlan | null => {
    const companyId = createSettingsRepository(db).read().activeCompanyId;
    if (companyId === null) return null;
    return repo.getCurrentForCompany(companyId);
  });

  ipcMain.handle(
    IPC.BUSINESS_PLAN_APPROVE,
    async (_e, payload: { businessPlanId: string }): Promise<{ ok: boolean; error?: string }> => {
      const userDataDir = app.getPath("userData");
      const companies = createCompaniesRepository(db);
      return approveBusinessPlan(db, userDataDir, payload.businessPlanId, {
        runDerivation: (i) => runDerivation({ runProcess: defaultRunProcess }, i),
        env: buildAuthEnv(db),
        writeTelos: writeTelosFile,
        setTelosPath: (companyId, telosPath) => companies.setTelosPath(companyId, telosPath),
      });
    },
  );

  ipcMain.handle(
    IPC.BUSINESS_PLAN_REJECT,
    (_e, payload: { businessPlanId: string; reason?: string }): { ok: true } => {
      repo.markRejected(payload.businessPlanId, payload.reason ?? null);
      return { ok: true };
    },
  );
};
