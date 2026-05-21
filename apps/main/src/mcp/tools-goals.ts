import { z } from "zod";
import { IPC } from "@prospero/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalPlansRepository } from "../goals/plans-repository.js";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createIssueCriteriaRepository } from "../goals/issue-criteria-repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { getCostBaseline } from "../costs/baseline.js";
import { GoalPlanPayloadSchema, type GoalPlanPayload } from "../schemas/goalPlan.js";
import type { ToolContext } from "./tools.js";
import type { GoalStatus, GoalLevel, IssueToCreate } from "@prospero/shared";

// Bundled ONLY into the MCP server, which runs as a standalone Node child (no
// Electron host) — importing "electron" crashed it ("Cannot find module
// 'electron'") so claude saw no tools at all. There are no windows to broadcast
// to here; live UI updates flow through ctx.emit -> EVENTS_DIR. This no-op shim
// keeps the (already dead) broadcast calls compiling.
const BrowserWindow: {
  getAllWindows: () => { webContents: { send: (channel: string, payload: unknown) => void } }[];
} = { getAllWindows: () => [] };

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

const listRoleTemplates: Tool = {
  name: "list_role_templates",
  description:
    "List available role templates (canonical agent blueprints with default model, capabilities, and system prompt). Used by the CEO during goal planning to pick agent types for new hires.",
  inputSchema: z.object({}),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (_input, ctx) => {
    const repo = createRoleTemplatesRepository(ctx.db);
    const templates = repo.listAll().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      defaultModel: t.defaultModel,
      defaultCapabilities: t.defaultCapabilities,
    }));
    return JSON.stringify({ templates });
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

    // The model often passes `plan` as a stringified JSON object instead of a
    // real object (same failure mode as submit_org_plan). Accept both: parse the
    // string before validating.
    let planValue: unknown = parsedShell.plan;
    if (typeof planValue === "string") {
      try {
        planValue = JSON.parse(planValue);
      } catch {
        throw new Error("invalid_plan: plan must be a JSON object (could not parse string)");
      }
    }

    const parsed = GoalPlanPayloadSchema.safeParse(planValue);
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
      // zod infers optional fields as `T | undefined`; under
      // exactOptionalPropertyTypes that is not assignable to IssueToCreate — the
      // cast is the standard bridge (the value is already zod-validated).
      issuesToCreate: payload.issuesToCreate as IssueToCreate[],
      estimatedTotalTokens: payload.estimatedTotalTokens ?? null,
      estimatedDurationDays: payload.estimatedDurationDays ?? null,
      estimatedCostCents: payload.estimatedCostCents ?? null,
      risks: payload.risks,
    });

    goalsRepo.updateStatus(goal.id, "proposed");

    const ceo = createAgentsRepository(ctx.db).getById(ctx.agentId);
    const ceoName = ceo?.name ?? "CEO";
    createInboxRepository(ctx.db).create({
      companyId: ctx.companyId,
      kind: "goal_proposed",
      actorId: ctx.agentId,
      title: `${ceoName} proposed a plan for "${goal.title}"`,
      preview: payload.summary.slice(0, 200),
      payloadJson: JSON.stringify({ goalId: goal.id, planId: plan.id }),
      requiresAction: true,
    });
    // BrowserWindow is undefined when this tool runs outside an Electron host
    // (unit tests). The DB write above is what matters; broadcast is best-effort.
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.INBOX_UPDATE, { companyId: ctx.companyId });
      }
    } catch {
      /* tests run without an Electron host */
    }

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

// ──────── M8.6 narrated execution tools ────────

const hireAgentForPlan: Tool = {
  name: "hire_agent_for_plan",
  description:
    "Hire one agent from the current plan's agentsToHire by index. Idempotent: returns the existing id if already hired. Requires this agent to be the CEO of an active narrated execution.",
  inputSchema: z.object({ planIndex: z.number().int().min(0) }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { planIndex } = hireAgentForPlan.inputSchema.parse(input) as { planIndex: number };
    const goalsRepo = createGoalsRepository(ctx.db);
    const goal = goalsRepo.findActiveNarratedByCeo(ctx.agentId);
    if (goal === null) throw new Error("no active narrated execution for this agent");
    const state = goalsRepo.getExecutionState(goal.id);
    if (state === null) throw new Error("execution state missing");
    const plansRepo = createGoalPlansRepository(ctx.db);
    const plan = plansRepo.getById(state.planId);
    if (plan === null) throw new Error(`plan ${state.planId} not found`);
    const agentSpec = plan.agentsToHire.find((a) => a.index === planIndex);
    if (agentSpec === undefined) {
      throw new Error(`planIndex ${planIndex} not in agentsToHire`);
    }
    if (state.includeAgentIndexes !== null && !state.includeAgentIndexes.includes(planIndex)) {
      throw new Error(`planIndex ${planIndex} excluded by filter`);
    }
    if (state.agentIndexToId[planIndex] !== undefined) {
      return JSON.stringify({ agentId: state.agentIndexToId[planIndex], existing: true });
    }
    let reportsToId: string;
    if (agentSpec.reportsToIndex === "CEO") {
      reportsToId = state.ceoId;
    } else {
      const resolved = state.agentIndexToId[agentSpec.reportsToIndex];
      if (resolved === undefined) {
        throw new Error(`reportsToIndex ${agentSpec.reportsToIndex} not yet hired`);
      }
      reportsToId = resolved;
    }
    const agentsRepo = createAgentsRepository(ctx.db, tryGetRecorder());
    const created = agentsRepo.create({
      companyId: ctx.companyId,
      name: agentSpec.name,
      role: agentSpec.roleTemplateId,
      systemPrompt: agentSpec.personaSummary,
      mode: "supervised",
      alwaysOn: false,
      model: agentSpec.model,
      capabilities: agentSpec.capabilities,
      templateId: agentSpec.roleTemplateId,
    });
    agentsRepo.setReportsTo(created.id, reportsToId);
    state.agentIndexToId[planIndex] = created.id;
    state.step = "hiring";
    goalsRepo.setExecutionState(goal.id, state);
    tryGetRecorder()?.recordActivity({
      companyId: ctx.companyId,
      actor: { kind: "agent", id: ctx.agentId },
      action: "goal.narrated_step",
      entityKind: "goal",
      entityId: goal.id,
      agentId: ctx.agentId,
      payload: { step: "hire", planIndex, agentId: created.id },
    });
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("agents:list-changed", { hiredAgentIds: [created.id] });
      }
    } catch {
      /* tests */
    }
    return JSON.stringify({ agentId: created.id, name: created.name });
  },
};

const createIssueForPlan: Tool = {
  name: "create_issue_for_plan",
  description:
    "Create one issue from the current plan's issuesToCreate by index. Requires assignee already hired and all dependsOnIndexes already created. Idempotent.",
  inputSchema: z.object({ planIndex: z.number().int().min(0) }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { planIndex } = createIssueForPlan.inputSchema.parse(input) as { planIndex: number };
    const goalsRepo = createGoalsRepository(ctx.db);
    const goal = goalsRepo.findActiveNarratedByCeo(ctx.agentId);
    if (goal === null) throw new Error("no active narrated execution for this agent");
    const state = goalsRepo.getExecutionState(goal.id);
    if (state === null) throw new Error("execution state missing");
    const plansRepo = createGoalPlansRepository(ctx.db);
    const plan = plansRepo.getById(state.planId);
    if (plan === null) throw new Error(`plan ${state.planId} not found`);
    const issueSpec = plan.issuesToCreate.find((i) => i.index === planIndex);
    if (issueSpec === undefined) {
      throw new Error(`planIndex ${planIndex} not in issuesToCreate`);
    }
    if (state.includeIssueIndexes !== null && !state.includeIssueIndexes.includes(planIndex)) {
      throw new Error(`planIndex ${planIndex} excluded by filter`);
    }
    if (state.issueIndexToId[planIndex] !== undefined) {
      return JSON.stringify({ issueId: state.issueIndexToId[planIndex], existing: true });
    }
    let assigneeId: string;
    if (issueSpec.assigneeIndex === "CEO") {
      assigneeId = state.ceoId;
    } else {
      const resolved = state.agentIndexToId[issueSpec.assigneeIndex];
      if (resolved === undefined) {
        throw new Error(`assignee #${issueSpec.assigneeIndex} not yet hired`);
      }
      assigneeId = resolved;
    }
    const dependsOnIds: string[] = [];
    for (const depIdx of issueSpec.dependsOnIndexes) {
      const resolved = state.issueIndexToId[depIdx];
      if (resolved === undefined) {
        throw new Error(`dep #${depIdx} not created yet`);
      }
      dependsOnIds.push(resolved);
    }
    const issuesRepo = createIssuesRepository(ctx.db);
    const created = issuesRepo.create(
      {
        companyId: ctx.companyId,
        projectId: null,
        title: issueSpec.title,
        description: issueSpec.description,
        priority: issueSpec.priority,
        assigneeId,
        parentId: null,
        createdBy: ctx.agentId,
      },
      { actorKind: "agent", actorId: ctx.agentId },
    );
    ctx.db
      .prepare("UPDATE issues SET goal_id = ?, depends_on_json = ? WHERE id = ?")
      .run(goal.id, dependsOnIds.length > 0 ? JSON.stringify(dependsOnIds) : null, created.id);
    // M13: link the ISCs this issue advances. Skip ids that don't belong to
    // this goal (a stale criterion id must not abort plan execution).
    const criteriaRepo = createGoalCriteriaRepository(ctx.db);
    const issueCriteriaRepo = createIssueCriteriaRepository(ctx.db);
    for (const criterionId of issueSpec.advancesCriteria ?? []) {
      const criterion = criteriaRepo.getById(criterionId);
      if (criterion !== null && criterion.goalId === goal.id) {
        issueCriteriaRepo.link(created.id, criterionId);
      }
    }
    state.issueIndexToId[planIndex] = created.id;
    state.step = "creating_issues";
    goalsRepo.setExecutionState(goal.id, state);
    tryGetRecorder()?.recordActivity({
      companyId: ctx.companyId,
      actor: { kind: "agent", id: ctx.agentId },
      action: "goal.narrated_step",
      entityKind: "goal",
      entityId: goal.id,
      agentId: ctx.agentId,
      payload: { step: "issue", planIndex, issueId: created.id },
    });
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("issues:list-changed", { createdIssueIds: [created.id] });
      }
    } catch {
      /* tests */
    }
    return JSON.stringify({ issueId: created.id, title: created.title });
  },
};

const finalizeGoalExecution: Tool = {
  name: "finalize_goal_execution",
  description:
    "Close the narrated execution loop. Validates all plan items processed and transitions goal to in_progress. Pass abort=true to roll back created agents/issues and cancel the goal.",
  inputSchema: z.object({
    goalId: z.string(),
    abort: z.boolean().optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { goalId, abort } = finalizeGoalExecution.inputSchema.parse(input) as {
      goalId: string;
      abort?: boolean;
    };
    const goalsRepo = createGoalsRepository(ctx.db);
    const goal = goalsRepo.getById(goalId);
    if (goal === null || goal.companyId !== ctx.companyId) {
      throw new Error(`goal ${goalId} not found`);
    }
    const state = goalsRepo.getExecutionState(goalId);
    if (state === null) throw new Error("no active execution for this goal");
    const plansRepo = createGoalPlansRepository(ctx.db);
    const plan = plansRepo.getById(state.planId);
    if (plan === null) throw new Error(`plan ${state.planId} not found`);

    if (abort === true) {
      const agentsRepo = createAgentsRepository(ctx.db);
      const issuesRepo = createIssuesRepository(ctx.db);
      ctx.db.transaction(() => {
        for (const id of Object.values(state.issueIndexToId)) {
          issuesRepo.delete(id);
        }
        // agents.delete doesn't exist; terminate is the closest equivalent
        // (status='terminated' + audit trail). Hard-delete left for future.
        for (const id of Object.values(state.agentIndexToId)) {
          agentsRepo.terminate(id, "aborted narrated execution");
        }
        plansRepo.markRejected(plan.id, "aborted by CEO during narrated execution");
        goalsRepo.updateStatus(goalId, "cancelled");
        goalsRepo.setExecutionState(goalId, null);
      })();
      return JSON.stringify({ aborted: true });
    }

    const expectedAgents = state.includeAgentIndexes ?? plan.agentsToHire.map((a) => a.index);
    const expectedIssues = state.includeIssueIndexes ?? plan.issuesToCreate.map((i) => i.index);
    const missingAgents = expectedAgents.filter((i) => state.agentIndexToId[i] === undefined);
    const missingIssues = expectedIssues.filter((i) => state.issueIndexToId[i] === undefined);
    if (missingAgents.length > 0 || missingIssues.length > 0) {
      throw new Error(
        `incomplete: missingAgents=${JSON.stringify(missingAgents)} missingIssues=${JSON.stringify(missingIssues)}`,
      );
    }

    plansRepo.markApproved(plan.id, { decidedBy: "ceo-narrated" });
    goalsRepo.updateStatus(goalId, "in_progress");
    goalsRepo.setExecutionState(goalId, null);

    const hiredAgentIds = Object.values(state.agentIndexToId);
    const createdIssueIds = Object.values(state.issueIndexToId);

    createInboxRepository(ctx.db).create({
      companyId: ctx.companyId,
      kind: "goal_executing",
      title: `Plan for "${goal.title}" is executing`,
      preview: `${hiredAgentIds.length} agents hired, ${createdIssueIds.length} issues created (narrated)`,
      payloadJson: JSON.stringify({ goalId, planId: plan.id }),
      requiresAction: false,
    });
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.INBOX_UPDATE, { companyId: ctx.companyId });
      }
    } catch {
      /* tests */
    }

    tryGetRecorder()?.recordActivity({
      companyId: ctx.companyId,
      actor: { kind: "agent", id: ctx.agentId },
      action: "goal.plan_approved",
      entityKind: "goal",
      entityId: goalId,
      agentId: ctx.agentId,
      payload: {
        planId: plan.id,
        version: plan.version,
        hiredAgentIds,
        createdIssueIds,
        approvedBy: "ceo-narrated",
      },
    });

    return JSON.stringify({ ok: true, hiredAgentIds, createdIssueIds });
  },
};

export const goalsToolDefinitions: Tool[] = [
  listGoals,
  getGoal,
  updateGoalStatus,
  recordSubgoal,
  listRoleTemplates,
  getCostBaselineTool,
  submitGoalPlan,
  hireAgentForPlan,
  createIssueForPlan,
  finalizeGoalExecution,
];
