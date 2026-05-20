import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

type ColumnRow = { name: string; dflt_value: string | null; notnull: number };

describe("migration 0030 — goal_criteria.attempts", () => {
  it("adds the attempts column with default 0 and NOT NULL", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(goal_criteria)").all() as ColumnRow[];
    const attempts = cols.find((c) => c.name === "attempts");
    expect(attempts).toBeDefined();
    expect(attempts!.notnull).toBe(1);
    expect(attempts!.dflt_value).toBe("0");
  });

  it("existing criteria backfill to attempts = 0 with the column default", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    // Insert a minimal company + goal + criterion to exercise the default.
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      "INSERT INTO goals (id, company_id, title, level, status, created_at, updated_at) VALUES ('g1','c1','t','task','draft',0,0)",
    ).run();
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, created_at, updated_at) VALUES ('cr1','g1',0,'s','deterministic','pending',0,0)",
    ).run();
    const row = db.prepare("SELECT attempts FROM goal_criteria WHERE id = 'cr1'").get() as {
      attempts: number;
    };
    expect(row.attempts).toBe(0);
  });
});
