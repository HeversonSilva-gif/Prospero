import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { goalsToolDefinitions } from "./tools-goals.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import type { ToolContext } from "./tools.js";

const setup = (): {
  ctx: ToolContext;
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
  return {
    ctx: {
      agentId: ceo.id,
      companyId: company.id,
      db,
      permissionsDir: "",
      userDataDir: "/tmp/userdata",
      emit: () => undefined,
    },
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
    issuesToCreate: [],
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

  it("accepts valid plan and creates version 1 + transitions goal to proposed", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");

    const tool = findTool("submit_goal_plan");
    const result = JSON.parse(await tool.run({ goalId: goal.id, plan: validPayload }, env.ctx)) as {
      planId: string;
      version: number;
    };
    expect(result.version).toBe(1);

    const afterGoal = goalsRepo.getById(goal.id);
    expect(afterGoal?.status).toBe("proposed");
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
    expect(goalsRepo.getById(goal.id)?.status).toBe("proposed");
  });

  it("supersedes existing proposed plan when re-submitted in planning state", async () => {
    const goalsRepo = createGoalsRepository(env.ctx.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");
    const tool = findTool("submit_goal_plan");
    await tool.run({ goalId: goal.id, plan: validPayload }, env.ctx);
    goalsRepo.updateStatus(goal.id, "planning");
    const second = JSON.parse(await tool.run({ goalId: goal.id, plan: validPayload }, env.ctx)) as {
      planId: string;
      version: number;
    };
    expect(second.version).toBe(2);
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
});
