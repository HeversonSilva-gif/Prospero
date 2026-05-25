import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

type ColumnRow = { name: string };

describe("migration 0039 — project digest path", () => {
  it("adds digest_path to projects", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare("PRAGMA table_info(projects)").all() as ColumnRow[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("digest_path");
    db.close();
  });

  it("digest_path is nullable", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      "INSERT INTO projects (id, company_id, name, path, created_at) VALUES ('p1','c1','P1','/path',0)",
    ).run();
    const result = db.prepare("SELECT digest_path FROM projects WHERE id = 'p1'").get() as {
      digest_path: string | null;
    };
    expect(result.digest_path).toBeNull();
    db.close();
  });
});
