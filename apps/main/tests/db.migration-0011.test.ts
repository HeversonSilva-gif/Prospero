import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; notnull: number };

describe("migration 0011 — cost_events table + budget settings seed", () => {
  it("drops legacy costs_log table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='costs_log'")
      .get() as { name: string } | undefined;
    expect(row).toBeUndefined();
  });

  it("creates cost_events with all expected columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(cost_events)") as ColumnInfo[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "company_id",
        "agent_id",
        "project_id",
        "issue_id",
        "adapter_name",
        "model",
        "session_id",
        "input_tokens",
        "output_tokens",
        "cache_creation_tokens",
        "cache_read_tokens",
        "cost_cents_estimate",
        "occurred_at",
      ]),
    );
  });

  it("creates the 5 cost_events indexes", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(cost_events)") as Array<{ name: string }>).map(
      (i) => i.name,
    );
    expect(idx).toContain("idx_cost_events_company_day");
    expect(idx).toContain("idx_cost_events_agent_day");
    expect(idx).toContain("idx_cost_events_project");
    expect(idx).toContain("idx_cost_events_adapter");
    expect(idx).toContain("idx_cost_events_issue");
  });

  it("seeds 4 budget.* settings keys with defaults", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'budget.%' ORDER BY key")
      .all() as Array<{ key: string; value: string }>;
    expect(rows).toEqual([
      { key: "budget.max_tokens_per_day_per_agent", value: "2000000" },
      { key: "budget.max_tokens_per_issue", value: "200000" },
      { key: "budget.rate_limit_window_hours", value: "5" },
      { key: "budget.rate_limit_window_tokens", value: "1000000" },
    ]);
  });
});
