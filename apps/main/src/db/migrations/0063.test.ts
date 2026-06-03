import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0063 — curator_staleness_hash", () => {
  it("adds source_versions_json column to skill_proposals", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(skill_proposals)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain("source_versions_json");
  });

  it("allows NULL source_versions_json (backward compat for pre-0063 rows)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);

    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Co', 0)").run();
    db.prepare(
      `
      INSERT INTO skill_proposals
        (id, company_id, kind, source_skill_ids, rationale, status, created_at, source_versions_json)
      VALUES
        ('p1', 'c1', 'archive', '["s1"]', 'old row', 'pending', 0, NULL)
    `,
    ).run();

    const row = db
      .prepare("SELECT source_versions_json FROM skill_proposals WHERE id = 'p1'")
      .get() as { source_versions_json: string | null };
    expect(row.source_versions_json).toBeNull();
  });

  it("round-trips source_versions_json as a JSON object", () => {
    const db = new Database(":memory:");
    applyMigrations(db);

    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Co', 0)").run();
    const versions = JSON.stringify({ skill_abc: 3, skill_def: 1 });
    db.prepare(
      `
      INSERT INTO skill_proposals
        (id, company_id, kind, source_skill_ids, rationale, status, created_at, source_versions_json)
      VALUES
        ('p2', 'c1', 'patch', '["skill_abc"]', 'test', 'pending', 0, ?)
    `,
    ).run(versions);

    const row = db
      .prepare("SELECT source_versions_json FROM skill_proposals WHERE id = 'p2'")
      .get() as { source_versions_json: string };
    const parsed = JSON.parse(row.source_versions_json) as Record<string, number>;
    expect(parsed["skill_abc"]).toBe(3);
    expect(parsed["skill_def"]).toBe(1);
  });
});
