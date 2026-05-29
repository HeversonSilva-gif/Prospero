import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

const seedCompanyAgent = (db: Database.Database): void => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','dev','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',0,0)`,
  ).run();
};

describe("migration 0046 — learning-loop CHECK constraints", () => {
  it("allows trigger 'verification_failed' on skill_candidates", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgent(db);
    db.prepare(
      "INSERT INTO activity_events (id, company_id, actor_kind, action, entity_kind, entity_id, payload_json, created_at) VALUES ('e1','c1','system','verification.failed','goal','g1','{}',0)",
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO skill_candidates (id, company_id, agent_id, source_event_id, trigger, proposed_name, proposed_description, proposed_body, status, created_at)
         VALUES ('cand1','c1','a1','e1','verification_failed','n','d','b','pending',0)`,
        )
        .run(),
    ).not.toThrow();
    db.close();
  });

  it("allows source 'derived_from_verification' on skills", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgent(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO skills (id, company_id, agent_id, name, body_path, description, version, applies_to_role, source, trust, use_count, last_used, promoted, created_at, soft_deleted)
         VALUES ('s1','c1','a1','n','/p','d',1,NULL,'derived_from_verification',0.5,0,NULL,0,0,0)`,
        )
        .run(),
    ).not.toThrow();
    db.close();
  });

  it("still rejects an unknown source", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgent(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO skills (id, company_id, agent_id, name, body_path, description, version, applies_to_role, source, trust, use_count, last_used, promoted, created_at, soft_deleted)
         VALUES ('s2','c1','a1','n','/p','d',1,NULL,'bogus_source',0.5,0,NULL,0,0,0)`,
        )
        .run(),
    ).toThrow();
    db.close();
  });
});
