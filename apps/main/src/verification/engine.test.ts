import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { runGoalVerification } from "./engine.js";
import type { VerifyContext } from "./checks.js";

const ctxWith = (db: Database.Database, exitCode: number): VerifyContext => ({
  db,
  sandboxRoot: process.cwd(),
  runCommand: () => Promise.resolve({ exitCode, stdout: "", stderr: "", timedOut: false }),
  callMetricTool: () => Promise.resolve({}),
});

describe("runGoalVerification", () => {
  let db: Database.Database;
  let goalId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
  });

  const addCommandCriterion = (): string =>
    createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: {
        checkType: "command",
        command: "pnpm test",
        expectedExitCode: 0,
        timeoutMs: 1000,
      },
    }).id;

  it("a goal with no criteria passes trivially (back-compat)", async () => {
    const report = await runGoalVerification(goalId, ctxWith(db, 0));
    expect(report.allPassed).toBe(true);
    expect(report.results).toEqual([]);
    expect(report.pendingJudgment).toEqual([]);
  });

  it("all deterministic criteria passing yields allPassed and persists status", async () => {
    const critId = addCommandCriterion();
    const report = await runGoalVerification(goalId, ctxWith(db, 0));
    expect(report.allPassed).toBe(true);
    expect(createGoalCriteriaRepository(db).getById(critId)?.status).toBe("passed");
  });

  it("a failing deterministic criterion yields allPassed=false", async () => {
    addCommandCriterion();
    const report = await runGoalVerification(goalId, ctxWith(db, 1));
    expect(report.allPassed).toBe(false);
    expect(report.results.some((r) => r.status === "failed")).toBe(true);
  });

  it("a pending judgment criterion keeps the goal unverified", async () => {
    createGoalCriteriaRepository(db).create({ goalId, statement: "on brand", kind: "judgment" });
    const report = await runGoalVerification(goalId, ctxWith(db, 0));
    expect(report.allPassed).toBe(false);
    expect(report.pendingJudgment).toHaveLength(1);
  });

  it("a passed judgment criterion counts toward allPassed", async () => {
    const c = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    createGoalCriteriaRepository(db).setJudgment(c.id, "passed", null);
    const report = await runGoalVerification(goalId, ctxWith(db, 0));
    expect(report.allPassed).toBe(true);
    expect(report.pendingJudgment).toEqual([]);
  });
});
