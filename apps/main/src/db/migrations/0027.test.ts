import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

type ColumnRow = { name: string };

describe("migration 0027 — isa criteria", () => {
  it("creates goal_criteria with the expected columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare("PRAGMA table_info(goal_criteria)").all() as ColumnRow[]).map(
      (c) => c.name,
    );
    for (const name of [
      "id",
      "goal_id",
      "sort_order",
      "statement",
      "kind",
      "check_type",
      "check_spec",
      "status",
      "last_checked_at",
      "last_result_json",
      "verified_by",
      "created_at",
      "updated_at",
    ]) {
      expect(cols).toContain(name);
    }
  });

  it("adds isa_path to goals", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare("PRAGMA table_info(goals)").all() as ColumnRow[]).map((c) => c.name);
    expect(cols).toContain("isa_path");
  });

  it("rejects an invalid criterion kind via the CHECK constraint", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      "INSERT INTO goals (id, company_id, title, level, status, created_at, updated_at) VALUES ('g1','c1','G','task','draft',0,0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, created_at, updated_at) VALUES ('x','g1',0,'s','bogus','pending',0,0)",
        )
        .run(),
    ).toThrow();
  });

  it("rejects an invalid criterion status via the CHECK constraint", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c2','Acme',0)").run();
    db.prepare(
      "INSERT INTO goals (id, company_id, title, level, status, created_at, updated_at) VALUES ('g2','c2','G','task','draft',0,0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, created_at, updated_at) VALUES ('y','g2',0,'s','judgment','running',0,0)",
        )
        .run(),
    ).toThrow();
  });
});
