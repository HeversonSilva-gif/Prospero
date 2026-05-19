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
});
