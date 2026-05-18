import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./migrations.js";

describe("migrations", () => {
  it("0023 adds the skills.soft_deleted_at column", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("soft_deleted_at");
  });
});
