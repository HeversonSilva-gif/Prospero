import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0058 — owner_profile", () => {
  it("adds owner_profile to business_plans and companies", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      );
    expect(cols("business_plans")).toContain("owner_profile");
    expect(cols("companies")).toContain("owner_profile");
  });
});
