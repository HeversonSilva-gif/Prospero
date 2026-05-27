import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

function seed(db: Database.Database): void {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Co', 0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1', 'c1', 'A', 'engineer', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run();
}

describe("migration 0042 — approval coalescing", () => {
  it("adds coalesced_with column nullable with default NULL", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db);
    db.prepare(
      `INSERT INTO approvals (id, agent_id, kind, payload_json, status, created_at)
       VALUES ('apv_solo', 'a1', 'tool_call', '{}', 'pending', 0)`,
    ).run();
    const row = db.prepare("SELECT coalesced_with FROM approvals WHERE id = 'apv_solo'").get() as {
      coalesced_with: string | null;
    };
    expect(row.coalesced_with).toBeNull();
    db.close();
  });

  it("follower can be linked to a head approval", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db);
    db.prepare(
      `INSERT INTO approvals (id, agent_id, kind, payload_json, status, created_at)
       VALUES ('apv_head', 'a1', 'tool_call', '{}', 'pending', 0),
              ('apv_follower', 'a1', 'tool_call', '{}', 'pending', 0)`,
    ).run();
    db.prepare("UPDATE approvals SET coalesced_with = 'apv_head' WHERE id = 'apv_follower'").run();
    const row = db
      .prepare("SELECT coalesced_with FROM approvals WHERE id = 'apv_follower'")
      .get() as { coalesced_with: string };
    expect(row.coalesced_with).toBe("apv_head");
    db.close();
  });

  it("creates idx_approvals_coalesced_with index", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(approvals)") as Array<{ name: string }>).map((i) => i.name);
    expect(idx).toContain("idx_approvals_coalesced_with");
    db.close();
  });
});
