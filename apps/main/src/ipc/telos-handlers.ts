import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import type { TelosDraft, TelosInterviewAnswers } from "@prospero/shared";
import { createCompaniesRepository } from "../companies/repository.js";
import { readTelos, writeTelos } from "../companies/telos-store.js";
import { relativeTelosPath } from "../companies/telos-dir.js";
import { synthesizeTelos } from "../companies/telos-synthesis.js";
import { runDerivation, defaultRunProcess } from "../derivation/runner.js";
import type { RunDerivationResult } from "../derivation/runner.js";
import { buildAuthEnv } from "../derivation/index.js";

export type TelosHandlersDeps = {
  db: Database.Database;
  userDataDir: string;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type TelosHandlers = {
  get(args: { companyId: string }): { body: string | null };
  save(args: { companyId: string; body: string }): void;
  synthesize(args: { companyId: string; answers: TelosInterviewAnswers }): Promise<TelosDraft>;
};

export const telosHandlers = (deps: TelosHandlersDeps): TelosHandlers => {
  const companiesRepo = createCompaniesRepository(deps.db);

  const requireCompany = (companyId: string) => {
    const company = companiesRepo.getById(companyId);
    if (company === null) throw new Error(`company not found: ${companyId}`);
    return company;
  };

  return {
    get({ companyId }) {
      requireCompany(companyId);
      return { body: readTelos(deps.userDataDir, companyId) };
    },

    save({ companyId, body }) {
      const company = requireCompany(companyId);
      writeTelos(deps.userDataDir, companyId, body);
      if (company.telosPath === null) {
        companiesRepo.setTelosPath(companyId, relativeTelosPath(companyId));
      }
    },

    synthesize({ companyId, answers }) {
      requireCompany(companyId);
      const env = buildAuthEnv(deps.db);
      return synthesizeTelos(
        { db: deps.db, runDerivation: deps.runDerivation },
        { answers, env, companyId },
      );
    },
  };
};

export const registerTelosHandlers = (db: Database.Database): void => {
  const h = telosHandlers({
    db,
    userDataDir: app.getPath("userData"),
    runDerivation: (input) => runDerivation({ runProcess: defaultRunProcess }, input),
  });
  ipcMain.handle(IPC.TELOS_GET, (_e, args: { companyId: string }) => h.get(args));
  ipcMain.handle(IPC.TELOS_SAVE, (_e, args: { companyId: string; body: string }) => h.save(args));
  ipcMain.handle(
    IPC.TELOS_SYNTHESIZE,
    (_e, args: { companyId: string; answers: TelosInterviewAnswers }) => h.synthesize(args),
  );
};
