import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

describe("migration 0019 — inbox skill_candidate_pending kind", () => {
  it("accepts an inbox item with kind skill_candidate_pending", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb1','c1','skill_candidate_pending','New skill candidate',1,0)`,
    ).run();
    const row = db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb1'").get() as {
      kind: string;
    };
    expect(row.kind).toBe("skill_candidate_pending");
  });

  it("still rejects an unknown kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('inb2','c1','bogus_kind','x',0,0)`,
        )
        .run(),
    ).toThrow();
  });
});
