import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0056 — connections email kind", () => {
  it("accepts kind 'email' and still rejects unknown kinds", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at)
           VALUES ('e1','c1','email','enc',0,0)`,
        )
        .run(),
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at)
           VALUES ('bad','c1','slack','enc',0,0)`,
        )
        .run(),
    ).toThrow();
  });
});
