import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0034 — companies.briefing_reviewed_at + briefing_headline_json", () => {
  it("adds both columns, defaulting to NULL on existing rows", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    const row = db
      .prepare("SELECT briefing_reviewed_at, briefing_headline_json FROM companies WHERE id = ?")
      .get("c1") as { briefing_reviewed_at: number | null; briefing_headline_json: string | null };
    expect(row.briefing_reviewed_at).toBeNull();
    expect(row.briefing_headline_json).toBeNull();
  });

  it("allows writing both columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    db.prepare(
      "UPDATE companies SET briefing_reviewed_at = ?, briefing_headline_json = ? WHERE id = ?",
    ).run(123, '{"hash":"x","text":"y","generatedAt":1}', "c1");
    const row = db
      .prepare("SELECT briefing_reviewed_at, briefing_headline_json FROM companies WHERE id = ?")
      .get("c1") as { briefing_reviewed_at: number | null; briefing_headline_json: string | null };
    expect(row.briefing_reviewed_at).toBe(123);
    expect(row.briefing_headline_json).toContain("hash");
  });
});
