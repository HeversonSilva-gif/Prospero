import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type Col = { name: string; type: string };

describe("migration 0014 — narrated execution columns", () => {
  it("adds goals.execution_state_json TEXT nullable", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(goals)") as Col[];
    const col = cols.find((c) => c.name === "execution_state_json");
    expect(col).toBeDefined();
    expect(col?.type).toBe("TEXT");
  });

  it("adds issues.depends_on_json TEXT nullable", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(issues)") as Col[];
    const col = cols.find((c) => c.name === "depends_on_json");
    expect(col).toBeDefined();
    expect(col?.type).toBe("TEXT");
  });

  it("creates idx_issues_depends_on partial index", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(issues)") as Array<{ name: string }>).map((i) => i.name);
    expect(idx).toContain("idx_issues_depends_on");
  });
});
