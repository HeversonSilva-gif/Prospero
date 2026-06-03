import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { toolDefinitions, type ToolContext } from "./tools.js";

const createTool = toolDefinitions.find((t) => t.name === "create_issue")!;

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const co = createCompaniesRepository(db).create({ name: "Acme" });
  const agent = createAgentsRepository(db).create({
    companyId: co.id,
    name: "CEO",
    role: "ceo",
    systemPrompt: "x",
    mode: "supervised",
    alwaysOn: true,
    model: "claude-sonnet-4-6",
    templateId: "ceo",
  });
  const project = createProjectsRepository(db).create({
    companyId: co.id,
    name: "Site",
    path: "/tmp/site",
    color: "#000",
  });
  const ctx: ToolContext = {
    agentId: agent.id,
    companyId: co.id,
    db,
    permissionsDir: "/tmp/perm",
    userDataDir: "/tmp/perm",
    emit: () => {},
  };
  return { db, co, project, ctx };
};

describe("create_issue — goal linking (C, audit 2026-06-03)", () => {
  it("links the new issue to goal_id when given, so its completion advances the goal", async () => {
    const { db, co, project, ctx } = setup();
    const goal = createGoalsRepository(db).create({ companyId: co.id, title: "Ship it" });
    const out = JSON.parse(
      await createTool.run(
        { project: project.name, title: "Build endpoint", goal_id: goal.id },
        ctx,
      ),
    ) as { id: string };
    const row = db.prepare("SELECT goal_id FROM issues WHERE id = ?").get(out.id) as {
      goal_id: string | null;
    };
    expect(row.goal_id).toBe(goal.id);
  });

  it("rejects a goal_id from another company", async () => {
    const { db, project, ctx } = setup();
    const otherCo = createCompaniesRepository(db).create({ name: "Other" });
    const foreignGoal = createGoalsRepository(db).create({
      companyId: otherCo.id,
      title: "Theirs",
    });
    const out = JSON.parse(
      await createTool.run({ project: project.name, title: "X", goal_id: foreignGoal.id }, ctx),
    ) as { ok?: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/goal/i);
  });

  it("still works with no goal_id (goal_id stays null)", async () => {
    const { db, project, ctx } = setup();
    const out = JSON.parse(
      await createTool.run({ project: project.name, title: "Loose issue" }, ctx),
    ) as { id: string };
    const row = db.prepare("SELECT goal_id FROM issues WHERE id = ?").get(out.id) as {
      goal_id: string | null;
    };
    expect(row.goal_id).toBeNull();
  });
});
