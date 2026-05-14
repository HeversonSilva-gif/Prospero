import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@dashboard-agent/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalPlansRepository } from "../goals/plans-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { formatGoalExecuteRequest } from "../goals/format-execute-request.js";
import type { GoalsOrchestrator } from "./goals-handlers.js";

export type NarratedHandlersDeps = {
  db: Database.Database;
  orchestrator: GoalsOrchestrator;
};

export type NarratedHandlers = {
  resume(args: { goalId: string }): { ok: true };
  rollback(args: { goalId: string }): { aborted: true };
};

export const narratedHandlers = (deps: NarratedHandlersDeps): NarratedHandlers => {
  const goalsRepo = createGoalsRepository(deps.db);
  const plansRepo = createGoalPlansRepository(deps.db);

  return {
    resume(args) {
      const state = goalsRepo.getExecutionState(args.goalId);
      if (state === null) throw new Error(`no active execution for goal ${args.goalId}`);
      const goal = goalsRepo.getById(args.goalId);
      const plan = plansRepo.getById(state.planId);
      if (goal === null || plan === null) throw new Error("goal or plan missing");
      const prompt = formatGoalExecuteRequest(goal, plan);
      deps.orchestrator.enqueueExecuteRequest(state.ceoId, prompt);
      return { ok: true };
    },
    rollback(args) {
      const state = goalsRepo.getExecutionState(args.goalId);
      if (state === null) throw new Error(`no active execution for goal ${args.goalId}`);
      const plan = plansRepo.getById(state.planId);
      if (plan === null) throw new Error("plan missing");
      const agentsRepo = createAgentsRepository(deps.db);
      const issuesRepo = createIssuesRepository(deps.db);
      deps.db.transaction(() => {
        for (const id of Object.values(state.issueIndexToId)) {
          issuesRepo.delete(id);
        }
        for (const id of Object.values(state.agentIndexToId)) {
          agentsRepo.terminate(id, "rolled back from halted narrated execution");
        }
        plansRepo.markRejected(plan.id, "rolled back from halted narrated execution");
        goalsRepo.updateStatus(args.goalId, "cancelled");
        goalsRepo.setExecutionState(args.goalId, null);
      })();
      return { aborted: true };
    },
  };
};

export const registerNarratedHandlers = (deps: NarratedHandlersDeps): void => {
  const h = narratedHandlers(deps);
  ipcMain.handle(IPC.GOALS_NARRATED_RESUME, (_e, args: { goalId: string }) => h.resume(args));
  ipcMain.handle(IPC.GOALS_NARRATED_ROLLBACK, (_e, args: { goalId: string }) => h.rollback(args));
};
