import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../src/db/migrations.js";
import { isaHandlers } from "../src/ipc/isa-handlers.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createGoalsRepository } from "../src/goals/repository.js";
import { createGoalCriteriaRepository } from "../src/goals/criteria-repository.js";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const setup = (derivationText = "{}") => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const userDataDir = mkdtempSync(join(tmpdir(), "isa-handlers-"));
  tmps.push(userDataDir);
  const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
  const goalId = createGoalsRepository(db).create({ companyId, title: "Launch" }).id;
  const h = isaHandlers({
    db,
    userDataDir,
    runDerivation: () =>
      Promise.resolve({
        text: derivationText,
        usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      }),
  });
  return { db, h, goalId };
};

describe("isaHandlers", () => {
  it("get materializes the ISA and stamps goals.isa_path", () => {
    const { db, h, goalId } = setup();
    const res = h.get({ goalId });
    expect(res.body).toContain("## Vision");
    const row = db.prepare("SELECT isa_path FROM goals WHERE id = ?").get(goalId) as {
      isa_path: string | null;
    };
    expect(row.isa_path).toMatch(/isa\.md$/);
  });

  it("save round-trips the ISA body and stamps isa_path", () => {
    const { db, h, goalId } = setup();
    h.save({ goalId, body: "# edited ISA\n" });
    expect(h.get({ goalId }).body).toBe("# edited ISA\n");
    const row = db.prepare("SELECT isa_path FROM goals WHERE id = ?").get(goalId) as {
      isa_path: string | null;
    };
    expect(row.isa_path).toMatch(/isa\.md$/);
  });

  it("criterion create / update / delete flows through", () => {
    const { h, goalId } = setup();
    const created = h.criterionCreate({ goalId, statement: "tests pass", kind: "judgment" });
    expect(h.get({ goalId }).criteria).toHaveLength(1);
    h.criterionUpdate({
      id: created.id,
      patch: { statement: "tests still pass", kind: "judgment", checkType: null, checkSpec: null },
    });
    expect(h.get({ goalId }).criteria[0]!.statement).toBe("tests still pass");
    h.criterionDelete({ id: created.id });
    expect(h.get({ goalId }).criteria).toHaveLength(0);
  });

  it("criterionCreate rejects an invalid checkSpec", () => {
    const { h, goalId } = setup();
    expect(() =>
      h.criterionCreate({
        goalId,
        statement: "x",
        kind: "deterministic",
        checkType: "command",
        checkSpec: { checkType: "command" } as never,
      }),
    ).toThrow();
  });

  it("get throws for an unknown goal", () => {
    const { h } = setup();
    expect(() => h.get({ goalId: "nope" })).toThrow(/not found/);
  });

  it("generate throws when runDerivation returns no ISA body", async () => {
    const { h, goalId } = setup(); // default "{}" — no isa key
    await expect(h.generate({ goalId })).rejects.toThrow(/no ISA body/);
  });

  it("generate returns a draft from a valid envelope", async () => {
    const envelope = JSON.stringify({ isa: "# x\n\n## Vision\n\ny", criteria: [] });
    const { h, goalId } = setup(envelope);
    const draft = await h.generate({ goalId });
    expect(draft.isa).toContain("## Vision");
  });

  it("criterionUpdate rejects an invalid checkSpec", () => {
    const { h, goalId } = setup();
    const created = h.criterionCreate({ goalId, statement: "x", kind: "judgment" });
    expect(() =>
      h.criterionUpdate({
        id: created.id,
        patch: {
          statement: "x",
          kind: "deterministic",
          checkType: "command",
          checkSpec: { checkType: "command" } as never,
        },
      }),
    ).toThrow();
  });

  it("criterionJudge resolves a judgment criterion and re-evaluates the goal", () => {
    const { db, h, goalId } = setup();
    const goalsRepo = createGoalsRepository(db);
    for (const s of ["planning", "proposed", "approved", "in_progress", "verifying"] as const) {
      goalsRepo.updateStatus(goalId, s);
    }
    const criteriaRepo = createGoalCriteriaRepository(db);
    const c = criteriaRepo.create({ goalId, statement: "on brand", kind: "judgment" });
    h.criterionJudge({ criterionId: c.id, verdict: "passed" });
    expect(criteriaRepo.getById(c.id)?.status).toBe("passed");
    expect(goalsRepo.getById(goalId)?.status).toBe("achieved");
  });

  it("criterionJudge throws for an unknown criterion", () => {
    const { h } = setup();
    expect(() => h.criterionJudge({ criterionId: "nope", verdict: "passed" })).toThrow(/not found/);
  });
});
