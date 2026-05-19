import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

type ColumnRow = { name: string };

describe("migration 0029 — telos", () => {
  it("adds telos_path to companies", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare("PRAGMA table_info(companies)").all() as ColumnRow[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("telos_path");
  });

  it("telos_path defaults to null for a new company", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    const row = db.prepare("SELECT telos_path FROM companies WHERE id = 'c1'").get() as {
      telos_path: string | null;
    };
    expect(row.telos_path).toBeNull();
  });
});
