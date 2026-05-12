import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; notnull: number };

describe("migration 0010 — agents pause/terminate columns", () => {
  it("adds paused_at, terminated_at, pause_reason columns to agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(agents)") as ColumnInfo[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("paused_at");
    expect(names).toContain("terminated_at");
    expect(names).toContain("pause_reason");
  });

  it("creates idx_agents_terminated index", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(agents)") as Array<{ name: string }>).map((i) => i.name);
    expect(idx).toContain("idx_agents_terminated");
  });
});
