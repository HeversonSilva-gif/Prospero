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

  it("preserves existing org_plans rows through the recreate", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgent(db);
    // applyMigrations runs all migrations up front, so we can't insert "before
    // 0048". Instead seed a representative row post-migration and assert every
    // column round-trips — guards a future copy of this recreate from silently
    // dropping a column.
    db.prepare(
      `INSERT INTO org_plans
         (id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
          status, user_feedback, proposed_at, decided_at)
       VALUES ('op_keep','c1','a1','keep me','[{"index":0}]','[]','proposed','fb',42,99)`,
    ).run();
    const row = db.prepare("SELECT * FROM org_plans WHERE id = 'op_keep'").get() as Record<
      string,
      unknown
    >;
    expect(row.id).toBe("op_keep");
    expect(row.company_id).toBe("c1");
    expect(row.proposed_by_agent_id).toBe("a1");
    expect(row.summary).toBe("keep me");
    expect(row.roles_json).toBe('[{"index":0}]');
    expect(row.agents_json).toBe("[]");
    expect(row.status).toBe("proposed");
    expect(row.user_feedback).toBe("fb");
    expect(row.proposed_at).toBe(42);
    expect(row.decided_at).toBe(99);
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
