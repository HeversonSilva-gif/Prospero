import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0062 — memories soft_deleted_at", () => {
  it("adds soft_deleted_at column to memories table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("soft_deleted_at");
  });

  it("soft_deleted_at defaults to NULL for new rows", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
         allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO memories (id, company_id, agent_id, applies_to_role, kind, body,
         importance, trust, source_event_id, pinned, created_at, last_accessed, access_count,
         soft_deleted)
       VALUES ('m1','c1','a1',NULL,'rule','body text',0.5,0.5,NULL,0,0,NULL,0,0)`,
    ).run();
    const row = db.prepare("SELECT soft_deleted_at FROM memories WHERE id = 'm1'").get() as {
      soft_deleted_at: number | null;
    };
    expect(row.soft_deleted_at).toBeNull();
  });

  it("allows setting soft_deleted_at to a timestamp", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
         allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO memories (id, company_id, agent_id, applies_to_role, kind, body,
         importance, trust, source_event_id, pinned, created_at, last_accessed, access_count,
         soft_deleted)
       VALUES ('m1','c1','a1',NULL,'rule','body text',0.5,0.5,NULL,0,0,NULL,0,0)`,
    ).run();
    const ts = 1_700_000_000_000;
    db.prepare("UPDATE memories SET soft_deleted = 1, soft_deleted_at = ? WHERE id = 'm1'").run(ts);
    const row = db.prepare("SELECT soft_deleted_at FROM memories WHERE id = 'm1'").get() as {
      soft_deleted_at: number | null;
    };
    expect(row.soft_deleted_at).toBe(ts);
  });
});
