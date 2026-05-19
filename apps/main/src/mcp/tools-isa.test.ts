import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../db/migrations.js";
import { isaToolDefinitions } from "./tools-isa.js";
import type { ToolContext } from "./tools.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const setup = (): { ctx: ToolContext; goalId: string } => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const userDataDir = mkdtempSync(join(tmpdir(), "tools-isa-"));
  tmps.push(userDataDir);
  const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
  const goalId = createGoalsRepository(db).create({
    companyId,
    title: "Launch",
    successCriteria: "A polished launch.",
  }).id;
  const ctx: ToolContext = {
    agentId: "agent_1",
    companyId,
    db,
    permissionsDir: "/tmp/perm",
    userDataDir,
    emit: () => {},
  };
  return { ctx, goalId };
};

const isaRead = isaToolDefinitions.find((t) => t.name === "isa_read")!;

describe("isa_read tool", () => {
  it("returns the materialized ISA body and criteria", async () => {
    const { ctx, goalId } = setup();
    createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
    });
    const out = JSON.parse(await isaRead.run({ goal_id: goalId }, ctx)) as {
      body: string;
      criteria: unknown[];
    };
    expect(out.body).toContain("A polished launch."); // seeded Vision
    expect(out.criteria).toHaveLength(1);
  });

  it("returns a single section when `section` is given", async () => {
    const { ctx, goalId } = setup();
    const out = JSON.parse(await isaRead.run({ goal_id: goalId, section: "Vision" }, ctx)) as {
      section: string;
      text: string;
    };
    expect(out.text).toBe("A polished launch.");
  });

  it("rejects a goal from another company", async () => {
    const { ctx, goalId } = setup();
    await expect(isaRead.run({ goal_id: goalId }, { ...ctx, companyId: "other" })).rejects.toThrow(
      /not found/,
    );
  });
});
