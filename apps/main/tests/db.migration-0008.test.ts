import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; notnull: number };

describe("migration 0008 — issue_artifacts", () => {
  it("creates the issue_artifacts table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(issue_artifacts)") as ColumnInfo[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ["id", "issue_id", "kind", "ref", "content_preview", "created_by", "created_at"].sort(),
    );
  });

  it("creates idx_artifacts_issue + idx_artifacts_kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(issue_artifacts)") as Array<{ name: string }>).map(
      (i) => i.name,
    );
    expect(idx).toContain("idx_artifacts_issue");
    expect(idx).toContain("idx_artifacts_kind");
  });
});
