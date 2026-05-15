import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

const columnNames = (db: Database.Database, table: string): string[] =>
  (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

describe("migration 0017 — rename skills columns to capabilities", () => {
  it("renames agents.skills_json to capabilities_json", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnNames(db, "agents");
    expect(cols).toContain("capabilities_json");
    expect(cols).not.toContain("skills_json");
  });

  it("renames role_templates.default_skills_json to default_capabilities_json", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnNames(db, "role_templates");
    expect(cols).toContain("default_capabilities_json");
    expect(cols).not.toContain("default_skills_json");
  });
});
