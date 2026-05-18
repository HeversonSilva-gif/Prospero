import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
};

describe("migration 0025 — org_plans", () => {
  it("creates the org_plans table", () => {
    const db = newDb();
    const cols = (db.pragma("table_info(org_plans)") as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "company_id",
        "proposed_by_agent_id",
        "summary",
        "roles_json",
        "agents_json",
        "status",
        "user_feedback",
        "proposed_at",
        "decided_at",
      ]),
    );
  });

  it("accepts the org_proposed inbox kind", () => {
    const db = newDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('i1','c1','org_proposed','Org proposed',1,0)`,
        )
        .run(),
    ).not.toThrow();
  });

  it("still rejects an unknown inbox kind", () => {
    const db = newDb();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('i2','c1','bogus_kind','x',0,0)`,
        )
        .run(),
    ).toThrow();
  });
});
