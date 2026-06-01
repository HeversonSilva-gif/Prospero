import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0057 — business plan research", () => {
  it("adds a nullable research_json column to business_plans", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (
      db.prepare("PRAGMA table_info(business_plans)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain("research_json");
  });
});
