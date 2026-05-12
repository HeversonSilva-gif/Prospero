import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: string | null };

describe("migration 0007 — approvals", () => {
  it("creates the approvals table with expected columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(approvals)") as ColumnInfo[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "id",
        "agent_id",
        "kind",
        "payload_json",
        "status",
        "decided_by",
        "decision_note",
        "created_at",
        "resolved_at",
      ].sort(),
    );
  });

  it("adds inbox_items.approval_id NULLable", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(inbox_items)") as ColumnInfo[];
    const col = cols.find((c) => c.name === "approval_id");
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(0);
  });

  it("creates approvals indexes", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(approvals)") as Array<{ name: string }>).map((i) => i.name);
    expect(idx).toContain("idx_approvals_agent");
    expect(idx).toContain("idx_approvals_status");
    expect(idx).toContain("idx_approvals_kind");
  });
});
