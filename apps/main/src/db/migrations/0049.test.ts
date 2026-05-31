import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

describe("migration 0049 — x growth", () => {
  it("creates x_posts and accepts a row", () => {
    const db = newDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO x_posts (id, company_id, tweet_id, text, posted_at) VALUES ('p1','c1','t1','hi',0)",
        )
        .run(),
    ).not.toThrow();
  });
  it("creates x_metrics, accepts account + tweet snapshots, rejects a bad kind", () => {
    const db = newDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO x_metrics (id, company_id, kind, subject_id, followers, captured_at)
           VALUES ('m1','c1','account',NULL,100,0)`,
        )
        .run(),
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO x_metrics (id, company_id, kind, subject_id, likes, captured_at)
           VALUES ('m2','c1','tweet','t1',5,0)`,
        )
        .run(),
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO x_metrics (id, company_id, kind, captured_at) VALUES ('m3','c1','bogus',0)`,
        )
        .run(),
    ).toThrow();
  });
});
