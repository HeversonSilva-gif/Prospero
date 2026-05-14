import { z } from "zod";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalPlansRepository } from "../goals/plans-repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { getCostBaseline } from "../costs/baseline.js";
import { GoalPlanPayloadSchema, type GoalPlanPayload } from "../schemas/goalPlan.js";
import type { ToolContext } from "./tools.js";
import type { GoalStatus, GoalLevel } from "@dashboard-agent/shared";

type Tool = {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  run: (input: unknown, ctx: ToolContext) => Promise<string>;
};

const listGoals: Tool = {
  name: "list_goals",
  description: "List goals in the current company, optionally filtered by status.",
  inputSchema: z.object({ status: z.string().optional() }),
  run: async (input, ctx) => {
    const { status } = listGoals.inputSchema.parse(input) as { status?: string };
    const repo = createGoalsRepository(ctx.db);
    const filter = status !== undefined ? { status: status as GoalStatus } : undefined;
    const goals = repo.listByCompany(ctx.companyId, filter);
    return Promise.resolve(JSON.stringify({ goals }));
  },
};

const getGoal: Tool = {
  name: "get_goal",
  description:
    "Get a goal with its current plan (if any) and history of superseded/rejected plans.",
  inputSchema: z.object({ id: z.string() }),
  run: async (input, ctx) => {
    const { id } = getGoal.inputSchema.parse(input) as { id: string };
    const goals = createGoalsRepository(ctx.db);
    const plans = createGoalPlansRepository(ctx.db);
    const goal = goals.getById(id);
    if (!goal || goal.companyId !== ctx.companyId) {
      throw new Error(`goal ${id} not found`);
    }
    return Promise.resolve(
      JSON.stringify({
        ...goal,
        currentPlan: plans.getCurrent(id),
        history: plans.getHistory(id),
      }),
    );
  },
};

const updateGoalStatus: Tool = {
  name: "update_goal_status",
  description:
    "Update goal status. Allowed transitions only. Used by CEO to mark achieved or cancel.",
  inputSchema: z.object({
    id: z.string(),
    status: z.string(),
    reason: z.string().optional(),
  }),
  run: async (input, ctx) => {
    const { id, status, reason } = updateGoalStatus.inputSchema.parse(input) as {
      id: string;
      status: string;
      reason?: string;
    };
    const repo = createGoalsRepository(ctx.db);
    const before = repo.getById(id);
    if (!before || before.companyId !== ctx.companyId) {
      throw new Error(`goal ${id} not found`);
    }
    const after = repo.updateStatus(id, status as GoalStatus, reason ?? null);
    tryGetRecorder()?.recordActivity({
      companyId: ctx.companyId,
      actor: { kind: "agent", id: ctx.agentId },
      action: "goal.status_changed",
      entityKind: "goal",
      entityId: id,
      agentId: ctx.agentId,
      payload: { from: before.status, to: after.status, reason: reason ?? null },
    });
    return Promise.resolve(JSON.stringify(after));
  },
};

const recordSubgoal: Tool = {
  name: "record_subgoal",
  description: "Record a sub-goal under an in_progress parent goal. Used by CEO during execution.",
  inputSchema: z.object({
    parentId: z.string(),
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    level: z.enum(["company", "team", "agent", "task"]).optional(),
  }),
  run: async (input, ctx) => {
    const args = recordSubgoal.inputSchema.parse(input) as {
      parentId: string;
      title: string;
      description?: string;
      level?: GoalLevel;
    };
    const repo = createGoalsRepository(ctx.db);
    const parent = repo.getById(args.parentId);
    if (!parent || parent.companyId !== ctx.companyId) {
      throw new Error(`parent goal ${args.parentId} not found`);
    }
    if (parent.status !== "in_progress") {
      throw new Error(`parent goal is not in_progress (status=${parent.status})`);
    }
    const child = repo.create({
      companyId: ctx.companyId,
      title: args.title,
      description: args.description ?? null,
      level: args.level ?? "task",
      parentGoalId: parent.id,
      ownerAgentId: ctx.agentId,
    });
    tryGetRecorder()?.recordActivity({
      companyId: ctx.companyId,
      actor: { kind: "agent", id: ctx.agentId },
      action: "goal.subgoal_recorded",
      entityKind: "goal",
      entityId: parent.id,
      agentId: ctx.agentId,
      payload: { childGoalId: child.id, recordedByAgentId: ctx.agentId },
    });
    return Promise.resolve(JSON.stringify(child));
  },
};

const getCostBaselineTool: Tool = {
  name: "get_cost_baseline",
  description:
    "Get average input/output tokens per turn for (templateId, model) from cost_events. Falls back to hardcoded table if sample < 5.",
  inputSchema: z.object({
    roleTemplateId: z.string(),
    model: z.string(),
  }),
  run: async (input, ctx) => {
    const { roleTemplateId, model } = getCostBaselineTool.inputSchema.parse(input) as {
      roleTemplateId: string;
      model: string;
    };
    const baseline = getCostBaseline(ctx.db, roleTemplateId, model);
    return Promise.resolve(JSON.stringify(baseline));
  },
};

const submitGoalPlan: Tool = {
  name: "submit_goal_plan",
  description:
    "Submit a structured plan for a goal in 'planning' status. Validates payload (Zod + DAG). Creates a new plan version and transitions the goal to 'proposed'. The user reviews and approves the plan in the UI.",
  inputSchema: z.object({
    goalId: z.string(),
    plan: z.unknown(),
  }),
  run: async (input, ctx) => {
    const parsedShell = submitGoalPlan.inputSchema.parse(input) as {
      goalId: string;
      plan: unknown;
    };
    const goalsRepo = createGoalsRepository(ctx.db);
    const plansRepo = createGoalPlansRepository(ctx.db);

    const goal = goalsRepo.getById(parsedShell.goalId);
    if (!goal || goal.companyId !== ctx.companyId) {
      throw new Error(`goal ${parsedShell.goalId} not found`);
    }
    if (goal.status !== "planning") {
      throw new Error(
        `goal ${parsedShell.goalId} is not in planning status (current=${goal.status})`,
      );
    }

    const parsed = GoalPlanPayloadSchema.safeParse(parsedShell.plan);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new Error(`invalid_plan: ${JSON.stringify(detail)}`);
    }
    const payload: GoalPlanPayload = parsed.data;

    const existing = plansRepo.getCurrent(goal.id);
    if (existing && existing.status === "proposed") {
      plansRepo.markSuperseded(existing.id);
    }

    const version = plansRepo.nextVersion(goal.id);
    const plan = plansRepo.insert({
      goalId: goal.id,
      version,
      proposedByAgentId: ctx.agentId,
      summary: payload.summary,
      agentsToHire: payload.agentsToHire,
      issuesToCreate: payload.issuesToCreate,
      estimatedTotalTokens: payload.estimatedTotalTokens ?? null,
      estimatedDurationDays: payload.estimatedDurationDays ?? null,
      estimatedCostCents: payload.estimatedCostCents ?? null,
      risks: payload.risks,
    });

    goalsRepo.updateStatus(goal.id, "proposed");

    tryGetRecorder()?.recordActivity({
      companyId: ctx.companyId,
      actor: { kind: "agent", id: ctx.agentId },
      action: "goal.plan_proposed",
      entityKind: "goal",
      entityId: goal.id,
      agentId: ctx.agentId,
      payload: {
        planId: plan.id,
        version: plan.version,
        agentsCount: payload.agentsToHire.length,
        issuesCount: payload.issuesToCreate.length,
        estimatedCostCents: payload.estimatedCostCents ?? null,
      },
    });

    return Promise.resolve(JSON.stringify({ planId: plan.id, version: plan.version }));
  },
};

export const goalsToolDefinitions: Tool[] = [
  listGoals,
  getGoal,
  updateGoalStatus,
  recordSubgoal,
  getCostBaselineTool,
  submitGoalPlan,
];
