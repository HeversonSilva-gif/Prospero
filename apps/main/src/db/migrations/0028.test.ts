import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

type ColumnRow = { name: string };

describe("migration 0028 — verification", () => {
  it("creates issue_criteria with a composite key", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare("PRAGMA table_info(issue_criteria)").all() as ColumnRow[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("issue_id");
    expect(cols).toContain("criterion_id");
  });

  it("accepts the two new inbox kinds", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    for (const kind of ["verification_failed", "verification_review"]) {
      expect(() =>
        db
          .prepare(
            "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?,?,?,?,0,0)",
          )
          .run(`inb_${kind}`, "c1", kind, "t"),
      ).not.toThrow();
    }
  });

  it("still rejects an unknown inbox kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c2','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?,?,?,?,0,0)",
        )
        .run("inb_x", "c2", "bogus_kind", "t"),
    ).toThrow();
  });

  it("enforces the composite primary key on issue_criteria", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c3','Acme',0)").run();
    db.prepare(
      "INSERT INTO goals (id, company_id, title, level, status, created_at, updated_at) VALUES ('g3','c3','G','task','draft',0,0)",
    ).run();
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, created_at, updated_at) VALUES ('cr1','g3',0,'s','judgment','pending',0,0)",
    ).run();
    db.prepare(
      "INSERT INTO issues (id, company_id, title, status, priority, created_at, updated_at) VALUES ('iss1','c3','I','todo','medium',0,0)",
    ).run();
    db.prepare("INSERT INTO issue_criteria (issue_id, criterion_id) VALUES ('iss1','cr1')").run();
    expect(() =>
      db.prepare("INSERT INTO issue_criteria (issue_id, criterion_id) VALUES ('iss1','cr1')").run(),
    ).toThrow();
  });
});
