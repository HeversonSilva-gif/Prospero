import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

describe("migration 0022 — inbox memory_review_needed kind", () => {
  it("0022 allows the memory_review_needed inbox kind and preserves prior kinds", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('ib1','c1','memory_review_needed','Memory fading',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('ib2','c1','goal_retrospective_ready','Retro',0,0)`,
    ).run();
    const n = (db.prepare("SELECT COUNT(*) AS n FROM inbox_items").get() as { n: number }).n;
    expect(n).toBe(2);
  });
});
