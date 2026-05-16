import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

describe("migration 0021 — inbox goal_retrospective_ready kind", () => {
  it("accepts an inbox item with kind goal_retrospective_ready", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb1','c1','goal_retrospective_ready','Retrospective',0,0)`,
    ).run();
    const row = db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb1'").get() as {
      kind: string;
    };
    expect(row.kind).toBe("goal_retrospective_ready");
  });

  it("still accepts the prior skill_promotion_requested kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb2','c1','skill_promotion_requested','x',1,0)`,
    ).run();
    expect(
      (db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb2'").get() as { kind: string }).kind,
    ).toBe("skill_promotion_requested");
  });
});
