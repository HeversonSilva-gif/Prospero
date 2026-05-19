import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { applyVerificationReport, runVerification } from "./index.js";
import type { RunVerificationDeps } from "./index.js";

const toVerifying = (db: Database.Database, companyId: string): string => {
  const repo = createGoalsRepository(db);
  const g = repo.create({ companyId, title: "G" });
  repo.updateStatus(g.id, "planning");
  repo.updateStatus(g.id, "proposed");
  repo.updateStatus(g.id, "approved");
  repo.updateStatus(g.id, "in_progress");
  repo.updateStatus(g.id, "verifying");
  return g.id;
};

const depsWith = (exitCode: number): RunVerificationDeps => ({
  sandboxRootFor: () => process.cwd(),
  callMetricTool: () => Promise.resolve({}),
  runCommand: () => Promise.resolve({ exitCode, stdout: "", stderr: "", timedOut: false }),
});

describe("verification gate", () => {
  let db: Database.Database;
  let companyId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
  });

  const addCommandCriterion = (goalId: string): void => {
    createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "x", expectedExitCode: 0, timeoutMs: 1000 },
    });
  };

  it("all-pass moves a verifying goal to achieved", async () => {
    const goalId = toVerifying(db, companyId);
    addCommandCriterion(goalId);
    await runVerification(db, goalId, depsWith(0));
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("achieved");
  });

  it("a goal with no criteria moves straight to achieved", async () => {
    const goalId = toVerifying(db, companyId);
    await runVerification(db, goalId, depsWith(0));
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("achieved");
  });

  it("a failed check bounces the goal to in_progress and files an inbox card", async () => {
    const goalId = toVerifying(db, companyId);
    addCommandCriterion(goalId);
    await runVerification(db, goalId, depsWith(1));
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("in_progress");
    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE company_id = ?")
      .all(companyId) as { kind: string }[];
    expect(inbox.some((i) => i.kind === "verification_failed")).toBe(true);
  });

  it("a pending judgment keeps the goal verifying and files a review card", async () => {
    const goalId = toVerifying(db, companyId);
    createGoalCriteriaRepository(db).create({ goalId, statement: "on brand", kind: "judgment" });
    await runVerification(db, goalId, depsWith(0));
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("verifying");
    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE company_id = ?")
      .all(companyId) as { kind: string }[];
    expect(inbox.some((i) => i.kind === "verification_review")).toBe(true);
  });

  it("applyVerificationReport ignores a goal not in verifying", () => {
    const repo = createGoalsRepository(db);
    const g = repo.create({ companyId, title: "G" });
    applyVerificationReport(db, {
      goalId: g.id,
      allPassed: true,
      results: [],
      pendingJudgment: [],
    });
    expect(repo.getById(g.id)?.status).toBe("draft");
  });
});
