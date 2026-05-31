import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

const seedCompanyAgent = (db: Database.Database): void => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','ceo','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',0,0)`,
  ).run();
};

describe("migration 0048 — org_plan critiquing status", () => {
  it("accepts 'critiquing' as a valid org_plans status", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgent(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO org_plans
             (id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
              status, proposed_at)
           VALUES ('op1','c1','a1','s','[]','[]','critiquing',0)`,
        )
        .run(),
    ).not.toThrow();
    db.close();
  });

  it("still rejects an unknown status", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgent(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO org_plans
             (id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
              status, proposed_at)
           VALUES ('op2','c1','a1','s','[]','[]','bogus',0)`,
        )
        .run(),
    ).toThrow();
    db.close();
  });
});
