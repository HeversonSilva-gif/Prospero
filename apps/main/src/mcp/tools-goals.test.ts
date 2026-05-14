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
});
