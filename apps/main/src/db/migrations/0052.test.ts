import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0052 — business plan pricing", () => {
  it("adds a nullable pricing_json column to business_plans", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (
      db.prepare("PRAGMA table_info(business_plans)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain("pricing_json");
  });

  it("accepts a business_plans row with pricing_json set", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO agents
         (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
          mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1','c1','CEO','ceo','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',0,0)`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO business_plans
             (id, company_id, proposed_by_agent_id, concept, monetization_json,
              pricing_json, marketing_json, identity_json, dropped_json, status, proposed_at)
           VALUES ('bp1','c1','a1','c','[]','{"model":"one_time"}','{}','{}','[]','critiquing',0)`,
        )
        .run(),
    ).not.toThrow();
  });
});
