import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0059 — tool_output_metrics", () => {
  it("creates tool_output_metrics with expected columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(tool_output_metrics)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "company_id",
        "agent_id",
        "tool_name",
        "raw_chars",
        "reduced_chars",
        "est_tokens_saved",
        "mode",
        "clamped",
        "created_at",
      ]),
    );
  });

  it("round-trips an insert", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      `INSERT INTO tool_output_metrics
       (id,company_id,agent_id,tool_name,raw_chars,reduced_chars,est_tokens_saved,mode,clamped,created_at)
       VALUES ('tom_1','c','a','isa_read',5000,800,1050,'json',1,123)`,
    ).run();
    const row = db
      .prepare(`SELECT tool_name, clamped FROM tool_output_metrics WHERE id='tom_1'`)
      .get() as { tool_name: string; clamped: number };
    expect(row.tool_name).toBe("isa_read");
    expect(row.clamped).toBe(1);
  });
});
