import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

// 0.2.X One Person Business — P1. The `connections` table holds external account
// connectors (X now, Stripe in P5): OAuth tokens encrypted in `ciphertext`,
// non-secret display info in `metadata_json`. One connection per (company, kind).
const seedCompany = (db: Database.Database): void => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
};

describe("migration 0047 — connections (external account connectors)", () => {
  it("stores an X connection for a company", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);
    db.prepare(
      `INSERT INTO connections (id, company_id, kind, ciphertext, metadata_json, created_at, updated_at)
       VALUES ('cx1','c1','x','<enc>','{"handle":"@me"}',0,0)`,
    ).run();
    const row = db
      .prepare("SELECT kind, ciphertext FROM connections WHERE company_id='c1'")
      .get() as { kind: string; ciphertext: string };
    expect(row.kind).toBe("x");
    expect(row.ciphertext).toBe("<enc>");
    db.close();
  });

  it("rejects an unknown connection kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at) VALUES ('cb','c1','bogus','e',0,0)",
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it("enforces one connection per (company, kind)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);
    db.prepare(
      "INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at) VALUES ('cx1','c1','x','e',0,0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at) VALUES ('cx2','c1','x','e2',0,0)",
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it("allows both an x and a stripe connection for the same company", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);
    db.prepare(
      "INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at) VALUES ('cx','c1','x','e',0,0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at) VALUES ('cs','c1','stripe','e',0,0)",
        )
        .run(),
    ).not.toThrow();
    db.close();
  });

  it("cascade-deletes connections when the company is deleted", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.pragma("foreign_keys = ON");
    seedCompany(db);
    db.prepare(
      "INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at) VALUES ('cx','c1','x','e',0,0)",
    ).run();
    db.prepare("DELETE FROM companies WHERE id='c1'").run();
    const count = db.prepare("SELECT COUNT(*) n FROM connections").get() as { n: number };
    expect(count.n).toBe(0);
    db.close();
  });
});
