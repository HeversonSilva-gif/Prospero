import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

// M4 (audit 2026-06-03 Conectores): x_posts.tweet_id had no UNIQUE constraint, so a
// replay could record the same tweet twice. 0066 adds a unique index, making the
// record path idempotent (INSERT OR IGNORE in the repository).
describe("migration 0066 — x_posts.tweet_id unique", () => {
  it("rejects a second row with the same tweet_id", () => {
    const db = newDb();
    db.prepare(
      "INSERT INTO x_posts (id, company_id, tweet_id, text, posted_at) VALUES ('p1','c1','t1','hi',0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO x_posts (id, company_id, tweet_id, text, posted_at) VALUES ('p2','c1','t1','dup',1)",
        )
        .run(),
    ).toThrow(/unique/i);
  });

  it("still accepts distinct tweet_ids", () => {
    const db = newDb();
    expect(() => {
      db.prepare(
        "INSERT INTO x_posts (id, company_id, tweet_id, text, posted_at) VALUES ('p1','c1','t1','a',0)",
      ).run();
      db.prepare(
        "INSERT INTO x_posts (id, company_id, tweet_id, text, posted_at) VALUES ('p2','c1','t2','b',1)",
      ).run();
    }).not.toThrow();
  });
});
