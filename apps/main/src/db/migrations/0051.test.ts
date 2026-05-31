import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','CEO','ceo','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',0,0)`,
  ).run();
  return db;
};

describe("migration 0051 — inbox business_proposed kind", () => {
  it("accepts an inbox item with kind 'business_proposed'", () => {
    const db = newDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items
             (id, company_id, kind, actor_id, title, preview, requires_action, created_at)
           VALUES ('i1','c1','business_proposed','a1','Negócio proposto','concept',1,0)`,
        )
        .run(),
    ).not.toThrow();
  });

  it("still rejects an unknown inbox kind", () => {
    const db = newDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items
             (id, company_id, kind, actor_id, title, preview, requires_action, created_at)
           VALUES ('i2','c1','bogus_kind','a1','x','y',1,0)`,
        )
        .run(),
    ).toThrow();
  });
});
