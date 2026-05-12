import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; dflt_value: string | null; notnull: number };
type IndexInfo = { name: string; unique: number };

describe("migration 0006 — messages.kind", () => {
  it("adds messages.kind NOT NULL default 'message'", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(messages)") as ColumnInfo[];
    const col = cols.find((c) => c.name === "kind");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("TEXT");
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toContain("message");
  });

  it("creates idx_messages_kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(messages)") as IndexInfo[]).find(
      (i) => i.name === "idx_messages_kind",
    );
    expect(idx).toBeDefined();
  });
});
