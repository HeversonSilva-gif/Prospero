import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0045 — curated_merge source", () => {
  it("allows curated_merge as a skill source", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO skills (id, company_id, name, body_path, description, source, created_at) VALUES ('s1','c1','sk','/p','d','curated_merge',0)",
        )
        .run(),
    ).not.toThrow();
    db.close();
  });

  it("still rejects unknown skill sources", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO skills (id, company_id, name, body_path, description, source, created_at) VALUES ('s2','c1','sk2','/p2','d','unknown_source',0)",
        )
        .run(),
    ).toThrow();
    db.close();
  });
});
