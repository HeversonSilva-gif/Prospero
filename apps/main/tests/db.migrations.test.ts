import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, getCurrentVersion } from "../src/db/migrations.js";

describe("applyMigrations", () => {
  it("starts at version 0 on a fresh database", () => {
    const db = new Database(":memory:");
    expect(getCurrentVersion(db)).toBe(0);
  });

  it("applies all migrations and bumps user_version", () => {
    const db = new Database(":memory:");
    const applied = applyMigrations(db);
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(getCurrentVersion(db)).toBe(applied.length);
  });

  it("is idempotent: running twice does not re-apply", () => {
    const db = new Database(":memory:");
    const first = applyMigrations(db);
    const second = applyMigrations(db);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(second.length).toBe(0);
  });

  it("creates the companies table after migration 0001", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'")
      .get();
    expect(row).toBeDefined();
  });
});
