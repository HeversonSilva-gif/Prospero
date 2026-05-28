import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0044 — curator proposals", () => {
  it("creates skill_proposals", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const t = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_proposals'")
      .get();
    expect(t).toBeTruthy();
    db.close();
  });
  it("allows the skill_consolidation_proposed inbox kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES ('i1','c1','skill_consolidation_proposed','t',1,0)",
        )
        .run(),
    ).not.toThrow();
    db.close();
  });
  it("preserves existing inbox kinds after the recreate", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES ('i2','c1','skill_candidate_pending','t',1,0)",
        )
        .run(),
    ).not.toThrow();
    db.close();
  });
});
