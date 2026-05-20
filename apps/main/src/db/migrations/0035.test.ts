import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0035 — routines table", () => {
  const setup = (): Database.Database => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, model,
                           status, mode, always_on, capabilities_json,
                           created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'idle', 'supervised', 0, '[]', ?, ?)`,
    ).run("a1", "c1", "Bob", "engineer", "", "claude-sonnet-4-6", Date.now(), Date.now());
    return db;
  };

  it("creates the table with all expected columns and defaults enabled=1", () => {
    const db = setup();
    db.prepare(
      `INSERT INTO routines (id, company_id, name, trigger_type, schedule_spec,
                             next_fire_at, target_agent_id, instruction,
                             created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "r1",
      "c1",
      "Standup",
      "schedule",
      '{"freq":"daily","atMinute":540}',
      1000,
      "a1",
      "Run standup",
      1,
      1,
    );
    const row = db.prepare("SELECT * FROM routines WHERE id = ?").get("r1") as Record<
      string,
      unknown
    >;
    expect(row.enabled).toBe(1);
    expect(row.trigger_type).toBe("schedule");
    expect(row.schedule_spec).toBe('{"freq":"daily","atMinute":540}');
    expect(row.next_fire_at).toBe(1000);
    expect(row.event_spec).toBeNull();
    expect(row.last_fired_at).toBeNull();
  });

  it("rejects trigger_type values outside the CHECK constraint", () => {
    const db = setup();
    expect(() =>
      db
        .prepare(
          `INSERT INTO routines (id, company_id, name, trigger_type,
                               target_agent_id, instruction, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("r2", "c1", "X", "manual", "a1", "Hi", 1, 1),
    ).toThrow();
  });

  it("cascades delete from companies", () => {
    const db = setup();
    db.prepare(
      `INSERT INTO routines (id, company_id, name, trigger_type,
                             target_agent_id, instruction, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("r1", "c1", "X", "schedule", "a1", "Hi", 1, 1);
    db.prepare("DELETE FROM companies WHERE id = ?").run("c1");
    const row = db.prepare("SELECT id FROM routines WHERE id = ?").get("r1");
    expect(row).toBeUndefined();
  });

  it("cascades delete from agents", () => {
    const db = setup();
    db.prepare(
      `INSERT INTO routines (id, company_id, name, trigger_type,
                             target_agent_id, instruction, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("r1", "c1", "X", "schedule", "a1", "Hi", 1, 1);
    db.prepare("DELETE FROM agents WHERE id = ?").run("a1");
    const row = db.prepare("SELECT id FROM routines WHERE id = ?").get("r1");
    expect(row).toBeUndefined();
  });

  it("creates idx_routines_company and idx_routines_next_fire", () => {
    const db = setup();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'routines'")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_routines_company");
    expect(names).toContain("idx_routines_next_fire");
  });
});
