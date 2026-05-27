import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

function seedCompany(db: Database.Database): void {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Co', 0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1', 'c1', 'Alice', 'engineer', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run();
}

describe("migration 0041 — async governance", () => {
  it("adds bounce_count column to approvals with default 0", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);

    db.prepare(
      `INSERT INTO approvals (id, agent_id, kind, payload_json, status, created_at)
       VALUES ('apv1', 'a1', 'tool_call', '{}', 'pending', 0)`,
    ).run();

    const row = db.prepare("SELECT bounce_count FROM approvals WHERE id = 'apv1'").get() as {
      bounce_count: number;
    };
    expect(row.bounce_count).toBe(0);
    db.close();
  });

  it("creates governance_config with FK cascade to companies", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);

    db.prepare(
      `INSERT INTO governance_config
         (company_id, quiet_hours_json, policies_json, updated_at)
         VALUES ('c1', '{}', '{}', 0)`,
    ).run();

    db.prepare("PRAGMA foreign_keys = ON").run();
    db.prepare("DELETE FROM companies WHERE id = 'c1'").run();
    const after = db
      .prepare("SELECT company_id FROM governance_config WHERE company_id = 'c1'")
      .get();
    expect(after).toBeUndefined();
    db.close();
  });

  it("is idempotent — applyMigrations called twice keeps schema stable", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const first = db.pragma("user_version", { simple: true }) as number;
    applyMigrations(db);
    const second = db.pragma("user_version", { simple: true }) as number;
    expect(second).toBe(first);
    db.close();
  });
});
