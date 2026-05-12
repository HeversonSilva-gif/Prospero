import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; notnull: number };
type IndexInfo = { name: string };

describe("migration 0009 — activity_events", () => {
  it("creates the activity_events table with all columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(activity_events)") as ColumnInfo[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "id",
        "company_id",
        "actor_kind",
        "actor_id",
        "action",
        "entity_kind",
        "entity_id",
        "agent_id",
        "payload_json",
        "created_at",
      ].sort(),
    );
  });

  it("creates 4 indexes on activity_events", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(activity_events)") as IndexInfo[]).map((i) => i.name);
    expect(idx).toContain("idx_activity_company_time");
    expect(idx).toContain("idx_activity_entity");
    expect(idx).toContain("idx_activity_agent_time");
    expect(idx).toContain("idx_activity_action");
  });

  it("enforces NOT NULL on required columns (id is implicit via PRIMARY KEY)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(activity_events)") as ColumnInfo[];
    const notNull = cols
      .filter((c) => c.notnull === 1)
      .map((c) => c.name)
      .sort();
    expect(notNull).toEqual(
      [
        "company_id",
        "actor_kind",
        "action",
        "entity_kind",
        "entity_id",
        "payload_json",
        "created_at",
      ].sort(),
    );
  });
});
