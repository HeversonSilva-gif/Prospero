import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0060 — business_plan_options", () => {
  it("adds options_json and chosen_index to business_plans", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(business_plans)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain("options_json");
    expect(cols).toContain("chosen_index");
  });

  it("options_json and chosen_index are nullable by default", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    // Insert a minimal company + agent so FK constraints are satisfied, then a plan
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO agents
         (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
          mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1','c1','CEO','ceo','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO business_plans
         (id, company_id, proposed_by_agent_id, concept, monetization_json,
          pricing_json, research_json, owner_profile, marketing_json, identity_json,
          dropped_json, status, user_feedback, proposed_at, decided_at)
       VALUES ('bp1','c1','a1','A concept','["R$9/mo"]',NULL,NULL,NULL,
               '{"initialChannel":"x","tactics":["posts"],"laterChannels":"later"}',
               '{"name":"Brand","voice":"friendly","proposedXHandle":"@brand"}',
               '[]','critiquing',NULL,1000,NULL)`,
    ).run();
    const row = db
      .prepare(`SELECT options_json, chosen_index FROM business_plans WHERE id='bp1'`)
      .get() as { options_json: string | null; chosen_index: number | null };
    expect(row.options_json).toBeNull();
    expect(row.chosen_index).toBeNull();
  });
});
