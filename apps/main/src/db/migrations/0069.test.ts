import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0069 — agents.pending_seed", () => {
  it("adds the pending_seed column to agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("pending_seed");
  });
});
