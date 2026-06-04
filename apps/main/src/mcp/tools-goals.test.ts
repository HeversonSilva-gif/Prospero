import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { goalsToolDefinitions } from "./tools-goals.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalPlansRepository } from "../goals/plans-repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createIssueCriteriaRepository } from "../goals/issue-criteria-repository.js";
import { executePlanAtomic } from "../goals/executor.js";
import { runGoalVerification } from "../verification/engine.js";
import type { VerifyContext } from "../verification/checks.js";
import type { ToolContext } from "./tools.js";

const setup = (): {
  ctx: ToolContext;
  emitted: Array<{ kind: string; payload: unknown }>;
  companyId: string;
  ceoId: string;
} => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createCompaniesRepository(db).create({ name: "Acme" });
  const ceo = createAgentsRepository(db).create({
    companyId: company.id,
    name: "CEO",
    role: "ceo",
    systemPrompt: "You are the CEO.",
    mode: "supervised",
    alwaysOn: true,
    model: "sonnet-4",
    templateId: "ceo",
  });
  const emitted: Array<{ kind: string; payload: unknown }> = [];
  return {
    ctx: {
      agentId: ceo.id,
      companyId: company.id,
      db,
      permissionsDir: "",
      userDataDir: "/tmp/userdata",
      emit: (e) => emitted.push(e),
    },
    emitted,
    companyId: company.id,
    ceoId: ceo.id,
  };
};

const findTool = (name: string) => {
  const t = goalsToolDefinitions.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
};

describe("goalsToolDefinitions — read tools", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it("list_goals returns goals scoped to current company", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    goalsRepo.create({ companyId: env.companyId, title: "A" });
    goalsRepo.create({ companyId: env.companyId, title: "B" });

    const tool = findTool("list_goals");
    const result = JSON.parse(await tool.run({}, env.ctx)) as { goals: { title: string }[] };
    expect(result.goals).toHaveLength(2);
  });

  it("list_goals filters by status", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const a = goalsRepo.create({ companyId: env.companyId, title: "A" });
    goalsRepo.create({ companyId: env.companyId, title: "B" });
    goalsRepo.updateStatus(a.id, "planning");

    const tool = findTool("list_goals");
    const result = JSON.parse(await tool.run({ status: "planning" }, env.ctx)) as {
      goals: { title: string }[];
    };
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]?.title).toBe("A");
  });

  it("get_goal returns goal + currentPlan + history", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const g = goalsRepo.create({ companyId: env.companyId, title: "X" });
    const tool = findTool("get_goal");
    const result = JSON.parse(await tool.run({ id: g.id }, env.ctx)) as {
      title: string;
      currentPlan: null;
      history: [];
    };
    expect(result.title).toBe("X");
    expect(result.currentPlan).toBeNull();
    expect(result.history).toEqual([]);
  });

  it("update_goal_status enforces state machine", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const g = goalsRepo.create({ companyId: env.companyId, title: "X" });
    const tool = findTool("update_goal_status");
    const result = JSON.parse(await tool.run({ id: g.id, status: "planning" }, env.ctx)) as {
      status: string;
    };
    expect(result.status).toBe("planning");

    await expect(tool.run({ id: g.id, status: "in_progress" }, env.ctx)).rejects.toThrow(
      /invalid transition/i,
    );
  });

  it("update_goal_status refuses to set 'achieved' directly (must go through verification)", async () => {
    // Audit 2026-06-03: the transition table allows in_progress -> achieved, so
    // the CEO could mark a goal done without any criteria being checked — the
    // same trust-laundering hole as C4/C8. Achievement must come from the gate.
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const g = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(g.id, "planning");
    goalsRepo.updateStatus(g.id, "proposed");
    goalsRepo.updateStatus(g.id, "approved");
    goalsRepo.updateStatus(g.id, "in_progress");
    const tool = findTool("update_goal_status");
    await expect(tool.run({ id: g.id, status: "achieved" }, env.ctx)).rejects.toThrow(
      /verification|cannot.*achieved/i,
    );
    // The goal must be untouched.
    expect(goalsRepo.getById(g.id)?.status).toBe("in_progress");
  });

  it("update_goal_status still allows cancelling and moving to verifying", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const g = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(g.id, "planning");
    goalsRepo.updateStatus(g.id, "proposed");
    goalsRepo.updateStatus(g.id, "approved");
    goalsRepo.updateStatus(g.id, "in_progress");
    const tool = findTool("update_goal_status");
    const out = JSON.parse(await tool.run({ id: g.id, status: "verifying" }, env.ctx)) as {
      status: string;
    };
    expect(out.status).toBe("verifying");
  });

  it("update_goal_status rejects a plain worker (no delegation) — authority C2", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const g = goalsRepo.create({ companyId: env.companyId, title: "X" });
    const worker = createAgentsRepository(env.ctx.db).create({
      companyId: env.companyId,
      name: "Eng",
      role: "engineer",
      systemPrompt: "sp",
      mode: "supervised",
      alwaysOn: false,
      model: "sonnet-4",
      capabilities: ["shell", "fs-write"],
    });
    const workerCtx = { ...env.ctx, agentId: worker.id };
    const tool = findTool("update_goal_status");
    await expect(tool.run({ id: g.id, status: "cancelled" }, workerCtx)).rejects.toThrow(
      /CEO|delegation|manager/i,
    );
  });

  it("record_subgoal creates child goal under in_progress parent", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const parent = goalsRepo.create({ companyId: env.companyId, title: "Parent" });
    goalsRepo.updateStatus(parent.id, "planning");
    goalsRepo.updateStatus(parent.id, "proposed");
    goalsRepo.updateStatus(parent.id, "approved");
    goalsRepo.updateStatus(parent.id, "in_progress");

    const tool = findTool("record_subgoal");
    const result = JSON.parse(
      await tool.run({ parentId: parent.id, title: "Child", description: "Sub-task" }, env.ctx),
    ) as { parentGoalId: string; title: string };
    expect(result.parentGoalId).toBe(parent.id);
    expect(result.title).toBe("Child");
  });

  it("record_subgoal rejects when parent not in_progress", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const parent = goalsRepo.create({ companyId: env.companyId, title: "Parent" });
    const tool = findTool("record_subgoal");
    await expect(tool.run({ parentId: parent.id, title: "C" }, env.ctx)).rejects.toThrow(
      /not in_progress/i,
    );
  });

  it("list_role_templates returns canonical templates with id, name, model, capabilities", async () => {
    env.ctx.db
      .prepare(
        `INSERT INTO role_templates (id, name, description, default_system_prompt, default_capabilities_json, default_model, icon)
         VALUES ('role-ceo', 'CEO', 'Receives requests from the user.', 'You are CEO.', '["delegation","chat"]', 'claude-opus-4-7', '📋'),
                ('role-engineer', 'Engineer', 'Writes code.', 'You are an engineer.', '["shell","fs-write"]', 'claude-sonnet-4-6', '👨‍💻')`,
      )
      .run();

    const tool = findTool("list_role_templates");
    const result = JSON.parse(await tool.run({}, env.ctx)) as {
      templates: Array<{
        id: string;
        name: string;
        description: string;
        defaultModel: string;
        defaultCapabilities: string[];
      }>;
    };
    expect(result.templates).toHaveLength(2);
    const ceo = result.templates.find((t) => t.id === "role-ceo");
    expect(ceo).toBeDefined();
    expect(ceo?.defaultModel).toBe("claude-opus-4-7");
    expect(ceo?.defaultCapabilities).toEqual(["delegation", "chat"]);
  });

  it("list_role_templates omits internal fields (defaultSystemPrompt, icon)", async () => {
    env.ctx.db
      .prepare(
        `INSERT INTO role_templates (id, name, description, default_system_prompt, default_capabilities_json, default_model, icon)
         VALUES ('role-qa', 'QA', 'Tests features.', 'You are QA.', '["shell"]', 'claude-sonnet-4-6', '🧪')`,
      )
      .run();
    const tool = findTool("list_role_templates");
    const result = JSON.parse(await tool.run({}, env.ctx)) as {
      templates: Array<Record<string, unknown>>;
    };
    expect(result.templates[0]).toBeDefined();
    expect(result.templates[0]).not.toHaveProperty("defaultSystemPrompt");
    expect(result.templates[0]).not.toHaveProperty("icon");
  });
});

describe("submit_goal_plan", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  const validPayload = {
    summary: "Sample plan summary spanning at least twenty characters of text.",
    agentsToHire: [],
    // A plan must create at least one issue (I-zero guard, audit 2026-06-03).
    issuesToCreate: [
      {
        index: 0,
        title: "Do the work",
        description: "",
        priority: "medium" as const,
        assigneeIndex: "CEO" as const,
        estimatedTokens: 1000,
        dependsOnIndexes: [] as number[],
        rationale: "core deliverable",
      },
    ],
    estimatedTotalTokens: 5000,
    estimatedDurationDays: 1,
    estimatedCostCents: 25,
    risks: [],
  };

  it("rejects when goal not in planning status", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    const tool = findTool("submit_goal_plan");
    await expect(tool.run({ goalId: goal.id, plan: validPayload }, env.ctx)).rejects.toThrow(
      /not in planning/i,
    );
  });

  it("inserts plan as critiquing, goal stays planning, no inbox card, emits goal.plan_proposed", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");

    const tool = findTool("submit_goal_plan");
    const result = JSON.parse(await tool.run({ goalId: goal.id, plan: validPayload }, env.ctx)) as {
      planId: string;
      version: number;
    };
    expect(result.version).toBe(1);

    // Plan is critiquing (MAIN's critic gates the card)
    expect(createGoalPlansRepository(env.ctx.db).getById(result.planId)?.status).toBe("critiquing");
    // Goal stays planning until MAIN flips it
    expect(goalsRepo.getById(goal.id)?.status).toBe("planning");
    // No inbox card created by the tool
    const inbox = env.ctx.db
      .prepare("SELECT kind FROM inbox_items WHERE company_id = ?")
      .all(env.companyId);
    expect(inbox).toEqual([]);
    // Event emitted
    expect(env.emitted).toContainEqual({
      kind: "goal.plan_proposed",
      payload: { goalId: goal.id, planId: result.planId },
    });
  });

  it("accepts a plan passed as a stringified JSON object", async () => {
    // The model often sends `plan` as a JSON string rather than an object.
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");

    const tool = findTool("submit_goal_plan");
    const result = JSON.parse(
      await tool.run({ goalId: goal.id, plan: JSON.stringify(validPayload) }, env.ctx),
    ) as { version: number };
    expect(result.version).toBe(1);
    // Goal stays planning (MAIN gates the transition)
    expect(goalsRepo.getById(goal.id)?.status).toBe("planning");
  });

  it("supersedes existing active plan (critiquing or proposed) when re-submitted in planning state", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");
    const tool = findTool("submit_goal_plan");
    const first = JSON.parse(await tool.run({ goalId: goal.id, plan: validPayload }, env.ctx)) as {
      planId: string;
      version: number;
    };
    // Goal is still planning (MAIN gates the transition) — can re-submit directly
    const second = JSON.parse(await tool.run({ goalId: goal.id, plan: validPayload }, env.ctx)) as {
      planId: string;
      version: number;
    };
    expect(second.version).toBe(2);
    // First plan superseded by supersedeActiveForGoal
    expect(createGoalPlansRepository(env.ctx.db).getById(first.planId)?.status).toBe("superseded");
  });

  it("returns Zod errors as structured detail", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");
    const tool = findTool("submit_goal_plan");
    const bad = { ...validPayload, summary: "tiny" };
    await expect(tool.run({ goalId: goal.id, plan: bad }, env.ctx)).rejects.toThrow(
      /invalid_plan/i,
    );
  });

  it("rejects a non-CEO caller (C1: caller authorization)", async () => {
    // Genesis/Planning audit C1: any agent with the `delegation` capability could
    // forge a goal plan. The tool must verify the caller is the CEO.
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");
    const worker = createAgentsRepository(env.ctx.db).create({
      companyId: env.companyId,
      name: "Worker",
      role: "engineer",
      systemPrompt: "x",
      mode: "supervised",
      alwaysOn: false,
      model: "sonnet-4",
      capabilities: ["delegation"],
      templateId: "engineer",
    });
    const tool = findTool("submit_goal_plan");
    const out = JSON.parse(
      await tool.run({ goalId: goal.id, plan: validPayload }, { ...env.ctx, agentId: worker.id }),
    ) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/ceo/i);
    // No plan stored.
    expect(createGoalPlansRepository(env.ctx.db).getCurrent(goal.id)).toBeNull();
    expect(env.ctx.db.prepare("SELECT id FROM goal_plans WHERE goal_id = ?").all(goal.id)).toEqual(
      [],
    );
  });

  it("allows the CEO caller to proceed (C1)", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");
    const tool = findTool("submit_goal_plan");
    const result = JSON.parse(await tool.run({ goalId: goal.id, plan: validPayload }, env.ctx)) as {
      planId: string;
    };
    expect(result.planId).toMatch(/^plan_/);
  });
});

describe("submit_goal_plan — acceptance criteria are persisted (I1)", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  // A plan whose only issue advances a criterion the CEO names by statement —
  // no human ISA-editor step ran first, so no real `goal_criteria` rows exist.
  const planWithCriteria = {
    summary: "Ship the landing page so the first visitor can sign up end-to-end.",
    agentsToHire: [],
    issuesToCreate: [
      {
        index: 0,
        title: "Build the landing page",
        description: "",
        priority: "medium" as const,
        assigneeIndex: "CEO" as const,
        estimatedTokens: 1000,
        dependsOnIndexes: [] as number[],
        advancesCriteria: ["The landing page is live and the signup form submits."],
        rationale: "core deliverable",
      },
    ],
    estimatedTotalTokens: 5000,
    estimatedDurationDays: 1,
    estimatedCostCents: 25,
    risks: [],
  };

  it("creates goal_criteria rows for advancesCriteria with no pre-existing criteria", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "Launch" });
    goalsRepo.updateStatus(goal.id, "planning");

    await findTool("submit_goal_plan").run({ goalId: goal.id, plan: planWithCriteria }, env.ctx);

    const criteria = createGoalCriteriaRepository(env.ctx.db).listByGoal(goal.id);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.statement).toBe("The landing page is live and the signup form submits.");
    // A statement with no checkSpec lands as a judgment criterion (real row that
    // verification reads — not a vacuous deterministic/null-spec no-op).
    expect(criteria[0]?.kind).toBe("judgment");
  });

  it("rewrites advancesCriteria to the persisted criterion id so the executor links them", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "Launch" });
    goalsRepo.updateStatus(goal.id, "planning");

    const res = JSON.parse(
      await findTool("submit_goal_plan").run({ goalId: goal.id, plan: planWithCriteria }, env.ctx),
    ) as { planId: string };

    const criteria = createGoalCriteriaRepository(env.ctx.db).listByGoal(goal.id);
    const critId = criteria[0]!.id;

    // The stored plan now references the real criterion id (not the raw statement).
    const stored = createGoalPlansRepository(env.ctx.db).getById(res.planId)!;
    expect(stored.issuesToCreate[0]?.advancesCriteria).toEqual([critId]);

    // And the executor resolves it: link the issue to the criterion on execution.
    goalsRepo.updateStatus(goal.id, "proposed");
    createGoalPlansRepository(env.ctx.db).markProposed(res.planId);
    const exec = executePlanAtomic(env.ctx.db, res.planId);
    expect(exec.ok).toBe(true);
    const issueId = (exec as { createdIssueIds: string[] }).createdIssueIds[0]!;
    const linked = createIssueCriteriaRepository(env.ctx.db).listCriteriaForIssue(issueId);
    expect(linked).toEqual([critId]);
  });

  it("makes verification non-vacuous: the goal does not trivially pass", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "Launch" });
    goalsRepo.updateStatus(goal.id, "planning");

    await findTool("submit_goal_plan").run({ goalId: goal.id, plan: planWithCriteria }, env.ctx);

    const verifyCtx: VerifyContext = {
      db: env.ctx.db,
      sandboxRoot: "/tmp/none",
      runCommand: () => Promise.reject(new Error("not used")),
      callMetricTool: () => Promise.reject(new Error("not used")),
    };
    const report = await runGoalVerification(goal.id, verifyCtx);
    // Before the fix the goal had zero criteria → allPassed:true trivially. Now a
    // pending judgment criterion exists, so the gate is NOT trivially satisfied.
    expect(report.results).toHaveLength(1);
    expect(report.allPassed).toBe(false);
    expect(report.pendingJudgment).toHaveLength(1);
  });

  it("reuses an existing human-authored criterion id (does not duplicate it)", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "Launch" });
    // Human ISA-editor path created a real criterion first.
    const existing = createGoalCriteriaRepository(env.ctx.db).create({
      goalId: goal.id,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "echo ok", expectedExitCode: 0, timeoutMs: 1000 },
    });
    goalsRepo.updateStatus(goal.id, "planning");

    const plan = {
      ...planWithCriteria,
      issuesToCreate: [{ ...planWithCriteria.issuesToCreate[0]!, advancesCriteria: [existing.id] }],
    };
    const res = JSON.parse(
      await findTool("submit_goal_plan").run({ goalId: goal.id, plan }, env.ctx),
    ) as { planId: string };

    // Existing id kept verbatim; no new criterion created.
    const criteria = createGoalCriteriaRepository(env.ctx.db).listByGoal(goal.id);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.id).toBe(existing.id);
    const stored = createGoalPlansRepository(env.ctx.db).getById(res.planId)!;
    expect(stored.issuesToCreate[0]?.advancesCriteria).toEqual([existing.id]);
  });
});
