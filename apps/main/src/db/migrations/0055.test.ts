import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0055 — connections cloudflare kind", () => {
  it("accepts a connections row with kind 'cloudflare' and still rejects unknown kinds", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at)
           VALUES ('cf1','c1','cloudflare','enc',0,0)`,
        )
        .run(),
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at)
           VALUES ('bad','c1','dropbox','enc',0,0)`,
        )
        .run(),
    ).toThrow();
  });

  it("preserves an existing x connection across the recreate", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at)
       VALUES ('x1','c1','x','enc',0,0)`,
    ).run();
    const row = db.prepare("SELECT kind FROM connections WHERE id='x1'").get() as { kind: string };
    expect(row.kind).toBe("x");
  });
});
