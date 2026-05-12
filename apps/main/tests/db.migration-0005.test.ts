import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; dflt_value: string | null; notnull: number };
type IndexInfo = { name: string; unique: number };

const columnsOf = (db: Database.Database, table: string): ColumnInfo[] =>
  db.pragma(`table_info(${table})`) as ColumnInfo[];

const indexesOf = (db: Database.Database, table: string): IndexInfo[] =>
  db.pragma(`index_list(${table})`) as IndexInfo[];

describe("migration 0005 — issue identifier", () => {
  it("adds projects.slug TEXT NULLable", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const col = columnsOf(db, "projects").find((c) => c.name === "slug");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("TEXT");
    expect(col?.notnull).toBe(0);
  });

  it("adds issues.issue_number INTEGER NULLable", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const col = columnsOf(db, "issues").find((c) => c.name === "issue_number");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("INTEGER");
    expect(col?.notnull).toBe(0);
  });

  it("adds issues.identifier TEXT NULLable", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const col = columnsOf(db, "issues").find((c) => c.name === "identifier");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("TEXT");
    expect(col?.notnull).toBe(0);
  });

  it("creates idx_issues_project_number UNIQUE", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = indexesOf(db, "issues").find((i) => i.name === "idx_issues_project_number");
    expect(idx).toBeDefined();
    expect(idx?.unique).toBe(1);
  });

  it("creates idx_issues_identifier non-unique", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = indexesOf(db, "issues").find((i) => i.name === "idx_issues_identifier");
    expect(idx).toBeDefined();
    expect(idx?.unique).toBe(0);
  });
});
