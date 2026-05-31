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

describe("migration 0050 — business plans", () => {
  it("creates business_plans and accepts a critiquing row", () => {
    const db = newDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO business_plans
             (id, company_id, proposed_by_agent_id, concept, monetization_json,
              marketing_json, identity_json, dropped_json, status, proposed_at)
           VALUES ('bp1','c1','a1','c','[]','{}','{}','[]','critiquing',0)`,
        )
        .run(),
    ).not.toThrow();
  });

  it("rejects an unknown status", () => {
    const db = newDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO business_plans
             (id, company_id, proposed_by_agent_id, concept, monetization_json,
              marketing_json, identity_json, dropped_json, status, proposed_at)
           VALUES ('bp2','c1','a1','c','[]','{}','{}','[]','bogus',0)`,
        )
        .run(),
    ).toThrow();
  });

  it("adds brand_voice and proposed_x_handle columns to companies", () => {
    const db = newDb();
    expect(() =>
      db
        .prepare("UPDATE companies SET brand_voice = ?, proposed_x_handle = ? WHERE id = 'c1'")
        .run("Friendly", "@acme"),
    ).not.toThrow();
  });
});
