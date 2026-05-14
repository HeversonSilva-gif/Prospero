import { ipcMain, BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@dashboard-agent/shared";
import type { Goal, GoalWithPlan, CreateGoalInput, GoalStatus } from "@dashboard-agent/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalPlansRepository } from "../goals/plans-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { formatGoalPlanRequest } from "../goals/format-request.js";
import { executePlan, type ExecuteResult } from "../goals/executor.js";
import { tryGetRecorder } from "../activity/index.js";

export type GoalsOrchestrator = {
  deliverSystemMessage: (agentId: string, text: string) => void;
  // M8.6: enqueue a system-actor turn carrying the execute-request payload.
  // Returns the thread id used so executePlanNarrated can persist it.
  enqueueExecuteRequest: (ceoId: string, prompt: string) => { threadId: string };
};

export type GoalsHandlersDeps = {
  db: Database.Database;
  orchestrator: GoalsOrchestrator;
};

const broadcast = (channel: string, payload: unknown): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
};

export type GoalsHandlers = {
  list(args: { companyId: string; status?: GoalStatus }): Promise<Goal[]>;
  get(args: { id: string }): Promise<GoalWithPlan>;
  create(args: CreateGoalInput): Promise<Goal>;
  requestPlan(args: { goalId: string }): Promise<{ ok: true }>;
  approvePlan(args: {
    planId: string;
    includeAgentIndexes?: number[];
    includeIssueIndexes?: number[];
  }): Promise<ExecuteResult>;
  requestChanges(args: { planId: string; feedback: string }): Promise<{ ok: true }>;
  rejectPlan(args: { planId: string; reason?: string }): Promise<{ ok: true }>;
};

export const goalsHandlers = (deps: GoalsHandlersDeps): GoalsHandlers => {
  const goalsRepo = createGoalsRepository(deps.db);
  const plansRepo = createGoalPlansRepository(deps.db);
  const agentsRepo = createAgentsRepository(deps.db, tryGetRecorder());

  const findCeo = (companyId: string): { id: string } | undefined =>
    agentsRepo.listByCompany(companyId).find((a) => a.templateId === "ceo" || a.role === "ceo");

  return {
    list(args) {
      const filter = args.status !== undefined ? { status: args.status } : undefined;
      return Promise.resolve(goalsRepo.listByCompany(args.companyId, filter));
    },

    get(args) {
      const goal = goalsRepo.getById(args.id);
      if (!goal) throw new Error(`goal ${args.id} not found`);
      return Promise.resolve({
        ...goal,
        currentPlan: plansRepo.getCurrent(args.id),
        history: plansRepo.getHistory(args.id),
      });
    },

    create(args) {
      const goal = goalsRepo.create(args);
      tryGetRecorder()?.recordActivity({
        companyId: goal.companyId,
        actor: { kind: "user" },
        action: "goal.created",
        entityKind: "goal",
        entityId: goal.id,
        payload: { title: goal.title, level: goal.level, parentGoalId: goal.parentGoalId },
      });
      return Promise.resolve(goal);
    },

    requestPlan(args) {
      const goal = goalsRepo.getById(args.goalId);
      if (!goal) throw new Error(`goal ${args.goalId} not found`);
      if (!["draft", "planning", "proposed"].includes(goal.status)) {
        throw new Error(`goal cannot request plan from status ${goal.status}`);
      }
      const existing = plansRepo.getCurrent(goal.id);
      if (existing && existing.status === "proposed") {
        plansRepo.markSuperseded(existing.id);
      }
      if (goal.status !== "planning") {
        goalsRepo.updateStatus(goal.id, "planning");
      }
      const ceo = findCeo(goal.companyId);
      if (!ceo) throw new Error(`no CEO for company ${goal.companyId}`);
      const goalAfter = goalsRepo.getById(goal.id);
      deps.orchestrator.deliverSystemMessage(ceo.id, formatGoalPlanRequest(goalAfter ?? goal));
      return Promise.resolve({ ok: true });
    },

    approvePlan(args) {
      const opts: {
        includeAgentIndexes?: Set<number>;
        includeIssueIndexes?: Set<number>;
      } = {};
      if (args.includeAgentIndexes !== undefined) {
        opts.includeAgentIndexes = new Set(args.includeAgentIndexes);
      }
      if (args.includeIssueIndexes !== undefined) {
        opts.includeIssueIndexes = new Set(args.includeIssueIndexes);
      }
      return Promise.resolve(executePlan(deps.db, args.planId, opts));
    },

    requestChanges(args) {
      const plan = plansRepo.getById(args.planId);
      if (!plan) throw new Error(`plan ${args.planId} not found`);
      plansRepo.markSuperseded(args.planId);

      const goal = goalsRepo.getById(plan.goalId);
      if (!goal) throw new Error(`goal ${plan.goalId} not found`);
      goalsRepo.updateStatus(goal.id, "planning");

      const ceo = findCeo(goal.companyId);
      const goalAfter = goalsRepo.getById(goal.id);
      if (ceo) {
        deps.orchestrator.deliverSystemMessage(
          ceo.id,
          formatGoalPlanRequest(goalAfter ?? goal, args.feedback),
        );
      }
      tryGetRecorder()?.recordActivity({
        companyId: goal.companyId,
        actor: { kind: "user" },
        action: "goal.plan_rejected",
        entityKind: "goal",
        entityId: goal.id,
        payload: {
          planId: plan.id,
          version: plan.version,
          reason: "superseded",
          userFeedback: args.feedback,
        },
      });
      return Promise.resolve({ ok: true });
    },

    rejectPlan(args) {
      const plan = plansRepo.getById(args.planId);
      if (!plan) throw new Error(`plan ${args.planId} not found`);
      plansRepo.markRejected(args.planId, args.reason ?? null);
      const goal = goalsRepo.getById(plan.goalId);
      if (!goal) throw new Error(`goal ${plan.goalId} not found`);
      goalsRepo.updateStatus(goal.id, "cancelled");
      tryGetRecorder()?.recordActivity({
        companyId: goal.companyId,
        actor: { kind: "user" },
        action: "goal.plan_rejected",
        entityKind: "goal",
        entityId: goal.id,
        payload: {
          planId: plan.id,
          version: plan.version,
          reason: "rejected",
          userFeedback: args.reason ?? null,
        },
      });
      return Promise.resolve({ ok: true });
    },
  };
};

export const registerGoalsHandlers = (deps: GoalsHandlersDeps): void => {
  const h = goalsHandlers(deps);
  ipcMain.handle(IPC.GOALS_LIST, (_e, args: { companyId: string; status?: GoalStatus }) =>
    h.list(args),
  );
  ipcMain.handle(IPC.GOALS_GET, (_e, args: { id: string }) => h.get(args));
  ipcMain.handle(IPC.GOALS_CREATE, async (_e, args: CreateGoalInput) => {
    const goal = await h.create(args);
    broadcast("goals:changed", { companyId: goal.companyId });
    return goal;
  });
  ipcMain.handle(IPC.GOALS_REQUEST_PLAN, (_e, args: { goalId: string }) => h.requestPlan(args));
  ipcMain.handle(
    IPC.GOALS_APPROVE_PLAN,
    async (
      _e,
      args: { planId: string; includeAgentIndexes?: number[]; includeIssueIndexes?: number[] },
    ) => {
      const plansRepoLocal = createGoalPlansRepository(deps.db);
      const goalsRepoLocal = createGoalsRepository(deps.db);
      const inboxRepo = createInboxRepository(deps.db);
      const planBefore = plansRepoLocal.getById(args.planId);
      const goalForInbox = planBefore !== null ? goalsRepoLocal.getById(planBefore.goalId) : null;
      const result = await h.approvePlan(args);
      if (result.ok && goalForInbox !== null) {
        broadcast("agents:list-changed", { hiredAgentIds: result.hiredAgentIds });
        broadcast("issues:list-changed", { createdIssueIds: result.createdIssueIds });
        inboxRepo.create({
          companyId: goalForInbox.companyId,
          kind: "goal_executing",
          title: `Plan for "${goalForInbox.title}" is executing`,
          preview: `${result.hiredAgentIds.length} agents hired, ${result.createdIssueIds.length} issues created`,
          payloadJson: JSON.stringify({ goalId: goalForInbox.id, planId: args.planId }),
          requiresAction: false,
        });
        broadcast(IPC.INBOX_UPDATE, { companyId: goalForInbox.companyId });
      } else if (!result.ok && goalForInbox !== null) {
        inboxRepo.create({
          companyId: goalForInbox.companyId,
          kind: "goal_error",
          title: `Plan execution failed for "${goalForInbox.title}"`,
          preview: `${result.failedAtStep}: ${result.error}`.slice(0, 200),
          payloadJson: JSON.stringify({ goalId: goalForInbox.id, planId: args.planId }),
          requiresAction: true,
        });
        broadcast(IPC.INBOX_UPDATE, { companyId: goalForInbox.companyId });
      }
      return result;
    },
  );
  ipcMain.handle(IPC.GOALS_REQUEST_CHANGES, (_e, args: { planId: string; feedback: string }) =>
    h.requestChanges(args),
  );
  ipcMain.handle(IPC.GOALS_REJECT_PLAN, (_e, args: { planId: string; reason?: string }) =>
    h.rejectPlan(args),
  );
};
