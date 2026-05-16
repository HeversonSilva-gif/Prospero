import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

describe("migration 0020 — inbox skill_promotion_requested kind", () => {
  it("accepts an inbox item with kind skill_promotion_requested", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb1','c1','skill_promotion_requested','Promote skill',1,0)`,
    ).run();
    const row = db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb1'").get() as {
      kind: string;
    };
    expect(row.kind).toBe("skill_promotion_requested");
  });

  it("still accepts the prior skill_candidate_pending kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb2','c1','skill_candidate_pending','x',1,0)`,
    ).run();
    expect(
      (db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb2'").get() as { kind: string }).kind,
    ).toBe("skill_candidate_pending");
  });
});
