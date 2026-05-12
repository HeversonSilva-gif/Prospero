import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; dflt_value: string | null; notnull: number };

const columnsOf = (db: Database.Database, table: string): ColumnInfo[] =>
  db.pragma(`table_info(${table})`) as ColumnInfo[];

describe("migration 0004 — agents.adapter_name", () => {
  it("adds agents.adapter_name column with default 'claude-oauth-local'", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnsOf(db, "agents");
    const adapterName = cols.find((c) => c.name === "adapter_name");
    expect(adapterName).toBeDefined();
    expect(adapterName?.type.toUpperCase()).toBe("TEXT");
    expect(adapterName?.notnull).toBe(1);
    expect(adapterName?.dflt_value).toContain("claude-oauth-local");
  });
});
