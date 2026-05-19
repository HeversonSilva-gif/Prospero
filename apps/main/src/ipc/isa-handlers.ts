import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import type {
  CreateCriterionInput,
  GoalCriterion,
  IsaDraft,
  UpdateCriterionInput,
} from "@prospero/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { readIsa, writeIsa } from "../goals/isa-store.js";
import { relativeIsaPath } from "../goals/isa-dir.js";
import { generateIsa } from "../goals/isa-generation.js";
import { criterionCheckSpecSchema } from "../schemas/criterionCheckSpec.js";
import { runDerivation, defaultRunProcess } from "../derivation/runner.js";
import type { RunDerivationResult } from "../derivation/runner.js";
import { buildAuthEnv } from "../derivation/index.js";
import { createSettingsRepository } from "../settings/repository.js";

export type IsaHandlersDeps = {
  db: Database.Database;
  userDataDir: string;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type IsaHandlers = {
  get(args: { goalId: string }): { body: string; criteria: GoalCriterion[] };
  save(args: { goalId: string; body: string }): void;
  generate(args: { goalId: string }): Promise<IsaDraft>;
  criterionCreate(args: CreateCriterionInput): GoalCriterion;
  criterionUpdate(args: { id: string; patch: UpdateCriterionInput }): GoalCriterion;
  criterionDelete(args: { id: string }): void;
};

export const isaHandlers = (deps: IsaHandlersDeps): IsaHandlers => {
  const goalsRepo = createGoalsRepository(deps.db);
  const criteriaRepo = createGoalCriteriaRepository(deps.db);

  const requireGoal = (goalId: string) => {
    const goal = goalsRepo.getById(goalId);
    if (goal === null) throw new Error(`goal not found: ${goalId}`);
    return goal;
  };

  // Stamp goals.isa_path the first time an ISA is materialized.
  const markMaterialized = (goalId: string, companyId: string): void => {
    const goal = goalsRepo.getById(goalId);
    if (goal !== null && goal.isaPath === null) {
      goalsRepo.setIsaPath(goalId, relativeIsaPath(companyId, goalId));
    }
  };

  return {
    get({ goalId }) {
      const goal = requireGoal(goalId);
      const body = readIsa(deps.userDataDir, goal);
      markMaterialized(goal.id, goal.companyId);
      return { body, criteria: criteriaRepo.listByGoal(goal.id) };
    },

    save({ goalId, body }) {
      const goal = requireGoal(goalId);
      writeIsa(deps.userDataDir, goal, body);
      markMaterialized(goal.id, goal.companyId);
    },

    generate({ goalId }) {
      const goal = requireGoal(goalId);
      const env = buildAuthEnv(deps.db);
      const companyId = createSettingsRepository(deps.db).read().activeCompanyId;
      const description = (goal.description ?? "").trim() || goal.title;
      return generateIsa(
        { db: deps.db, runDerivation: deps.runDerivation },
        { description, env, companyId },
      );
    },

    criterionCreate(args) {
      requireGoal(args.goalId);
      if (args.checkSpec != null) criterionCheckSpecSchema.parse(args.checkSpec);
      return criteriaRepo.create(args);
    },

    criterionUpdate({ id, patch }) {
      if (patch.checkSpec != null) criterionCheckSpecSchema.parse(patch.checkSpec);
      return criteriaRepo.update(id, patch);
    },

    criterionDelete({ id }) {
      criteriaRepo.delete(id);
    },
  };
};

export const registerIsaHandlers = (db: Database.Database): void => {
  const h = isaHandlers({
    db,
    userDataDir: app.getPath("userData"),
    runDerivation: (input) => runDerivation({ runProcess: defaultRunProcess }, input),
  });
  ipcMain.handle(IPC.ISA_GET, (_e, args: { goalId: string }) => h.get(args));
  ipcMain.handle(IPC.ISA_SAVE, (_e, args: { goalId: string; body: string }) => h.save(args));
  ipcMain.handle(IPC.ISA_GENERATE, (_e, args: { goalId: string }) => h.generate(args));
  ipcMain.handle(IPC.ISA_CRITERION_CREATE, (_e, args: CreateCriterionInput) =>
    h.criterionCreate(args),
  );
  ipcMain.handle(
    IPC.ISA_CRITERION_UPDATE,
    (_e, args: { id: string; patch: UpdateCriterionInput }) => h.criterionUpdate(args),
  );
  ipcMain.handle(IPC.ISA_CRITERION_DELETE, (_e, args: { id: string }) => h.criterionDelete(args));
};
