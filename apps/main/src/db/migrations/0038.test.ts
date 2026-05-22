import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

function insertCompany(db: Database.Database, id = "c1"): void {
  db.prepare("INSERT OR IGNORE INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    id,
    "Acme",
    Date.now(),
  );
}

describe("migration 0038 — inbox kinds manager_request + ceo_decision", () => {
  it("accepts manager_request as an inbox kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    insertCompany(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('inb_mr', 'c1', 'manager_request', 'Decisao pedida', 1, ?)`,
        )
        .run(Date.now()),
    ).not.toThrow();
  });

  it("accepts ceo_decision as an inbox kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    insertCompany(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('inb_cd', 'c1', 'ceo_decision', 'CEO aprovou', 0, ?)`,
        )
        .run(Date.now()),
    ).not.toThrow();
  });

  it("still rejects unknown inbox kinds (CHECK constraint preserved)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    insertCompany(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('inb_x', 'c1', 'totally_unknown', 'X', 0, ?)`,
        )
        .run(Date.now()),
    ).toThrow(/CHECK constraint failed/);
  });

  it("preserves the auto_mode_expired kind from 0036", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    insertCompany(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('inb_ame', 'c1', 'auto_mode_expired', 'Expirou', 0, ?)`,
        )
        .run(Date.now()),
    ).not.toThrow();
  });

  it("keeps idx_inbox_company_unread after the recreate", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_inbox_company_unread'",
      )
      .get();
    expect(idx).toBeDefined();
  });
});
