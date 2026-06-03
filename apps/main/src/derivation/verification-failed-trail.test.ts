import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { buildVerificationFailedTrail } from "./verification-failed-trail.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";

const seed = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    "INSERT INTO goals (id, company_id, title, description, status, created_at, updated_at) VALUES ('g1','c1','Ship X','users can do Y','verifying',0,0)",
  ).run();
  db.prepare(
    "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, last_result_json, created_at, updated_at) VALUES ('cr1','g1',0,'build passes','deterministic','failed',3,'{\"detail\":\"exit 1: tsc found 2 errors\"}',0,0)",
  ).run();
  db.prepare(
    "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, last_result_json, created_at, updated_at) VALUES ('cr2','g1',1,'tests pass','deterministic','passed',1,'{}',0,0)",
  ).run();
  return { db };
};

describe("buildVerificationFailedTrail", () => {
  it("returns null when the goal is missing", () => {
    const { db } = seed();
    expect(buildVerificationFailedTrail(db, "nope", ["cr1"])).toBeNull();
  });

  it("returns the goal + only the failed criteria the dispatcher named", () => {
    const { db } = seed();
    const trail = buildVerificationFailedTrail(db, "g1", ["cr1"]);
    expect(trail).not.toBeNull();
    expect(trail!.goalTitle).toBe("Ship X");
    expect(trail!.failed.length).toBe(1);
    expect(trail!.failed[0]!.statement).toBe("build passes");
    expect(trail!.failed[0]!.attempts).toBe(3);
    expect(trail!.failed[0]!.lastDetail).toContain("tsc found 2 errors");
  });

  it("ignores ids in the payload that no longer exist", () => {
    const { db } = seed();
    const trail = buildVerificationFailedTrail(db, "g1", ["cr1", "ghost"]);
    expect(trail!.failed.length).toBe(1);
  });

  it("surfaces the human detail persisted through the real applyResult path", () => {
    // The other tests hand-seed last_result_json as {"detail":...}, a shape the
    // production write path never produces. applyResult persists
    // result.resultJson ({exitCode,stdout,stderr}); the human-readable `detail`
    // must survive into last_result_json or the LEARN prompt sees nothing.
    const { db } = seed();
    createGoalCriteriaRepository(db).applyResult({
      criterionId: "cr2",
      status: "failed",
      detail: "exit 1: tsc found 2 errors",
      resultJson: { exitCode: 1, timedOut: false, stdout: "", stderr: "error TS2304" },
    });
    const trail = buildVerificationFailedTrail(db, "g1", ["cr2"]);
    expect(trail!.failed[0]!.lastDetail).toContain("tsc found 2 errors");
  });
});
