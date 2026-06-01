import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0054 — inbox 'sale' kind", () => {
  it("accepts an inbox_items row with kind 'sale'", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('i1','c1','sale','Primeira venda!',0,0)`,
        )
        .run(),
    ).not.toThrow();
  });

  it("still rejects an unknown kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
           VALUES ('i2','c1','not_a_kind','x',0,0)`,
        )
        .run(),
    ).toThrow();
  });
});
