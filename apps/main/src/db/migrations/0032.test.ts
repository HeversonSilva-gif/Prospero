import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0032 — trust_tier + trust_events", () => {
  it("adds trust_tier column defaulting to 'novato' on existing agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = Date.now();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      now,
    );
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(now, now);
    const row = db.prepare("SELECT trust_tier FROM agents WHERE id = ?").get("a1") as {
      trust_tier: string;
    };
    expect(row.trust_tier).toBe("novato");
  });

  it("creates trust_events with the kind CHECK and FK to agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(Date.now(), Date.now());

    db.prepare(
      `INSERT INTO trust_events (id, agent_id, kind, from_tier, to_tier, reason, created_at)
       VALUES ('e1','a1','promoted','novato','confiavel','5 verified outcomes',?)`,
    ).run(Date.now());

    expect(() =>
      db
        .prepare(
          `INSERT INTO trust_events (id, agent_id, kind, from_tier, to_tier, reason, created_at)
         VALUES ('e2','a1','exploded','novato','confiavel','no',?)`,
        )
        .run(Date.now()),
    ).toThrow(/CHECK constraint failed/);

    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
      .get("idx_trust_events_agent");
    expect(idx).toBeDefined();
  });
});
