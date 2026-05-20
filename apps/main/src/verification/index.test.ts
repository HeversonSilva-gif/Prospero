import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { applyVerificationReport, checkOneCriterion, runVerification } from "./index.js";
import type { RunVerificationDeps } from "./index.js";
import { createRecorder } from "../activity/recorder.js";
import { _setRecorderForTest } from "../activity/index.js";

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

  describe("activity event on failure", () => {
    afterEach(() => {
      _setRecorderForTest(null);
    });

    it("records a verification.failed activity event when a criterion fails", async () => {
      const recorder = createRecorder(db, () => {}, { devMode: false });
      _setRecorderForTest(recorder);
      const goalId = toVerifying(db, companyId);
      addCommandCriterion(goalId);
      await runVerification(db, goalId, depsWith(1));
      const rows = db
        .prepare(
          "SELECT action, entity_id, company_id FROM activity_events WHERE action = 'verification.failed'",
        )
        .all() as Array<{ action: string; entity_id: string; company_id: string }>;
      expect(rows.length).toBe(1);
      expect(rows[0]!.entity_id).toBe(goalId);
      expect(rows[0]!.company_id).toBe(companyId);
    });
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

  it("checkOneCriterion runs a deterministic check and persists the result", async () => {
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    const crit = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "x", expectedExitCode: 0, timeoutMs: 1000 },
    });
    const result = await checkOneCriterion(db, crit.id, depsWith(0));
    expect(result.status).toBe("passed");
    expect(createGoalCriteriaRepository(db).getById(crit.id)?.status).toBe("passed");
  });

  it("checkOneCriterion persists a failing result", async () => {
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    const crit = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "x", expectedExitCode: 0, timeoutMs: 1000 },
    });
    const result = await checkOneCriterion(db, crit.id, depsWith(1));
    expect(result.status).toBe("failed");
    expect(createGoalCriteriaRepository(db).getById(crit.id)?.status).toBe("failed");
  });

  it("checkOneCriterion throws for an unknown criterion", async () => {
    await expect(checkOneCriterion(db, "nope", depsWith(0))).rejects.toThrow(/not found/);
  });

  it("checkOneCriterion throws for a judgment criterion", async () => {
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    const crit = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await expect(checkOneCriterion(db, crit.id, depsWith(0))).rejects.toThrow(/deterministic/);
  });
});
