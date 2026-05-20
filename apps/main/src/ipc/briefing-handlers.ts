import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Briefing } from "@prospero/shared";
import { createCompaniesRepository } from "../companies/repository.js";
import { runDerivation, defaultRunProcess } from "../derivation/runner.js";
import type { RunDerivationResult } from "../derivation/runner.js";
import { buildAuthEnv } from "../derivation/index.js";
import { buildBriefing } from "../briefing/build.js";
import { generateBriefingHeadline } from "../briefing/headline.js";

// M14 PR-C — IPC bridge for the Morning Briefing.
//   briefing:get(companyId)        → Briefing
//   briefing:mark-reviewed(companyId) → void (advances the cursor)

export type BriefingHandlersDeps = {
  db: Database.Database;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
  authEnv: () => Record<string, string>;
};

export type BriefingHandlers = {
  get(args: { companyId: string }): Promise<Briefing>;
  markReviewed(args: { companyId: string }): Promise<void>;
};

export const briefingHandlers = (deps: BriefingHandlersDeps): BriefingHandlers => {
  const companiesRepo = createCompaniesRepository(deps.db);

  return {
    async get({ companyId }) {
      const now = Date.now();
      const company = companiesRepo.getById(companyId);
      const cursor = company?.briefingReviewedAt ?? null;
      const briefing = buildBriefing(deps.db, companyId, cursor, now);

      const headline = await generateBriefingHeadline(
        { db: deps.db, runDerivation: deps.runDerivation },
        {
          companyId,
          counters: {
            verified: briefing.verified.length,
            failed: briefing.failed.length,
            needsYou: briefing.needsYou.length,
            learned: briefing.learned.length,
            inProgress: briefing.inProgress.length,
            costCents: briefing.costCents,
          },
          env: deps.authEnv(),
        },
      );

      return { ...briefing, headline };
    },
    markReviewed({ companyId }) {
      companiesRepo.setBriefingReviewedAt(companyId, Date.now());
      return Promise.resolve();
    },
  };
};

export const registerBriefingHandlers = (db: Database.Database): void => {
  const h = briefingHandlers({
    db,
    runDerivation: (input) => runDerivation({ runProcess: defaultRunProcess }, input),
    authEnv: () => buildAuthEnv(db),
  });
  ipcMain.handle(IPC.BRIEFING_GET, (_e, args: { companyId: string }) => h.get(args));
  ipcMain.handle(IPC.BRIEFING_MARK_REVIEWED, (_e, args: { companyId: string }) =>
    h.markReviewed(args),
  );
};
