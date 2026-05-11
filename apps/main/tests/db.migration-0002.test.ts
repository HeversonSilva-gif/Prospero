import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, getCurrentVersion } from "../src/db/migrations.js";

describe("migration 0002", () => {
  it("creates issue_comments table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='issue_comments'")
      .get();
    expect(row).toBeDefined();
  });

  it("creates issue_events table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='issue_events'")
      .get();
    expect(row).toBeDefined();
  });

  it("applies migration 0002 (user_version >= 2)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(2);
  });

  it("issue_comments enforces sender_kind enum", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
    db.prepare(
      "INSERT INTO issues (id, company_id, title, created_at, updated_at) VALUES ('i1', 'c1', 'T', 0, 0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO issue_comments (id, issue_id, sender_kind, content, created_at) VALUES ('co1', 'i1', 'bogus', 'hi', 0)",
        )
        .run(),
    ).toThrow();
  });

  it("issue_events enforces kind enum", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
    db.prepare(
      "INSERT INTO issues (id, company_id, title, created_at, updated_at) VALUES ('i1', 'c1', 'T', 0, 0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO issue_events (id, issue_id, kind, actor_kind, payload_json, created_at) VALUES ('e1', 'i1', 'bogus', 'system', '{}', 0)",
        )
        .run(),
    ).toThrow();
  });

  it("issue_events enforces actor_kind enum", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
    db.prepare(
      "INSERT INTO issues (id, company_id, title, created_at, updated_at) VALUES ('i1', 'c1', 'T', 0, 0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO issue_events (id, issue_id, kind, actor_kind, payload_json, created_at) VALUES ('e1', 'i1', 'created', 'bogus', '{}', 0)",
        )
        .run(),
    ).toThrow();
  });
});
