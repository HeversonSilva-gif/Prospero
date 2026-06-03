import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createGoalsRepository } from "./repository.js";
import { createGoalCriteriaRepository } from "./criteria-repository.js";
import { createCompaniesRepository } from "../companies/repository.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
};

describe("goalCriteriaRepository", () => {
  let db: Database.Database;
  let goalId: string;

  beforeEach(() => {
    db = newDb();
    const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    goalId = createGoalsRepository(db).create({ companyId, title: "Launch" }).id;
  });

  it("create assigns an incrementing sort_order per goal", () => {
    const repo = createGoalCriteriaRepository(db);
    const a = repo.create({ goalId, statement: "tests pass", kind: "deterministic" });
    const b = repo.create({ goalId, statement: "on brand", kind: "judgment" });
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(1);
    expect(a.status).toBe("pending");
    expect(b.checkType).toBeNull();
  });

  it("round-trips a deterministic command criterion with its checkSpec", () => {
    const repo = createGoalCriteriaRepository(db);
    const created = repo.create({
      goalId,
      statement: "the suite passes",
      kind: "deterministic",
      checkType: "command",
      checkSpec: {
        checkType: "command",
        command: "pnpm test",
        expectedExitCode: 0,
        timeoutMs: 600000,
      },
    });
    const fetched = repo.getById(created.id);
    expect(fetched?.checkSpec).toEqual({
      checkType: "command",
      command: "pnpm test",
      expectedExitCode: 0,
      timeoutMs: 600000,
    });
  });

  it("listByGoal returns criteria ordered by sort_order", () => {
    const repo = createGoalCriteriaRepository(db);
    repo.create({ goalId, statement: "first", kind: "judgment" });
    repo.create({ goalId, statement: "second", kind: "judgment" });
    expect(repo.listByGoal(goalId).map((c) => c.statement)).toEqual(["first", "second"]);
  });

  it("listByGoal returns only the requested goal's criteria", () => {
    const companyId = createGoalsRepository(db).getById(goalId)!.companyId;
    const otherGoalId = createGoalsRepository(db).create({ companyId, title: "Other" }).id;
    const repo = createGoalCriteriaRepository(db);
    repo.create({ goalId, statement: "mine", kind: "judgment" });
    repo.create({ goalId: otherGoalId, statement: "theirs", kind: "judgment" });
    expect(repo.listByGoal(goalId).map((c) => c.statement)).toEqual(["mine"]);
  });

  it("update replaces all editable fields", () => {
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({ goalId, statement: "old", kind: "judgment" });
    const updated = repo.update(c.id, {
      statement: "new",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    expect(updated.statement).toBe("new");
    expect(updated.kind).toBe("deterministic");
    expect(updated.checkType).toBe("artifact_exists");
  });

  it("update throws when id does not exist", () => {
    const repo = createGoalCriteriaRepository(db);
    expect(() =>
      repo.update("crit_does_not_exist", {
        statement: "x",
        kind: "judgment",
        checkType: null,
        checkSpec: null,
      }),
    ).toThrow("criterion not found");
  });

  it("delete removes the row", () => {
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({ goalId, statement: "x", kind: "judgment" });
    repo.delete(c.id);
    expect(repo.getById(c.id)).toBeNull();
  });

  it("coerces a deterministic criterion with no checkSpec to judgment (C7b invariant)", () => {
    // Accepting an AI-proposed ISA sends a checkType HINT but no spec. A
    // deterministic criterion with checkSpec=null fails verification forever
    // ("no check spec"), so it must land as a judgment criterion instead.
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
    });
    expect(c.kind).toBe("judgment");
    expect(c.checkType).toBeNull();
    expect(c.checkSpec).toBeNull();
  });

  it("keeps a deterministic criterion that carries a real checkSpec", () => {
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "x", expectedExitCode: 0, timeoutMs: 1000 },
    });
    expect(c.kind).toBe("deterministic");
    expect(c.checkType).toBe("command");
    expect(c.checkSpec).not.toBeNull();
  });

  it("applyResult persists status, timestamp and result json", () => {
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({ goalId, statement: "tests pass", kind: "deterministic" });
    repo.applyResult({
      criterionId: c.id,
      status: "failed",
      detail: "exit 1",
      resultJson: { exitCode: 1 },
    });
    const fetched = repo.getById(c.id);
    expect(fetched?.status).toBe("failed");
    expect(fetched?.lastCheckedAt).not.toBeNull();
    // last_result_json carries the structured result AND the human `detail`, so
    // the LEARN failure trail can recover why it failed (Facet 5 M3).
    expect(fetched?.lastResultJson).toBe(JSON.stringify({ exitCode: 1, detail: "exit 1" }));
  });

  it("setJudgment persists status and verifiedBy", () => {
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({ goalId, statement: "on brand", kind: "judgment" });
    repo.setJudgment(c.id, "passed", null);
    const fetched = repo.getById(c.id);
    expect(fetched?.status).toBe("passed");
    expect(fetched?.verifiedBy).toBeNull();
    expect(fetched?.lastCheckedAt).not.toBeNull();
  });

  it("listByGoal returns attempts = 0 for a fresh criterion", () => {
    const repo = createGoalCriteriaRepository(db);
    repo.create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "echo ok", expectedExitCode: 0, timeoutMs: 1000 },
    });
    const list = repo.listByGoal(goalId);
    expect(list[0]!.attempts).toBe(0);
  });

  it("applyResult bumps attempts by 1 per call", () => {
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "echo ok", expectedExitCode: 0, timeoutMs: 1000 },
    });
    repo.applyResult({
      criterionId: c.id,
      status: "failed",
      detail: "x",
      resultJson: { exitCode: 1 },
    });
    repo.applyResult({
      criterionId: c.id,
      status: "failed",
      detail: "x",
      resultJson: { exitCode: 1 },
    });
    repo.applyResult({
      criterionId: c.id,
      status: "passed",
      detail: "x",
      resultJson: { exitCode: 0 },
    });
    expect(repo.getById(c.id)!.attempts).toBe(3);
  });
});
