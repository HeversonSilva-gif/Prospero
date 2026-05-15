import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; dflt_value: string | null; notnull: number };

const columnsOf = (db: Database.Database, table: string): ColumnInfo[] =>
  db.pragma(`table_info(${table})`) as ColumnInfo[];

describe("migration 0003 — roles & model", () => {
  it("adds agents.model column with default claude-sonnet-4-6", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnsOf(db, "agents");
    const model = cols.find((c) => c.name === "model");
    expect(model).toBeDefined();
    expect(model?.type.toUpperCase()).toBe("TEXT");
    expect(model?.notnull).toBe(1);
    expect(model?.dflt_value).toContain("claude-sonnet-4-6");
  });

  it("adds role_templates.default_model column", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnsOf(db, "role_templates");
    const def = cols.find((c) => c.name === "default_model");
    expect(def).toBeDefined();
    expect(def?.type.toUpperCase()).toBe("TEXT");
    expect(def?.notnull).toBe(1);
    expect(def?.dflt_value).toContain("claude-sonnet-4-6");
  });

  it("creates idx_agents_template index", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agents_template'")
      .get();
    expect(idx).toBeDefined();
  });

  it("agents inserted without model use the default 'claude-sonnet-4-6'", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, current_action, created_at, updated_at)
       VALUES ('a1', 'c1', 'X', 'x', '', '[]', '[]', 'supervised', 0, 'idle', NULL, 0, 0)`,
    ).run();
    const row = db.prepare("SELECT model FROM agents WHERE id = 'a1'").get() as { model: string };
    expect(row.model).toBe("claude-sonnet-4-6");
  });
});
