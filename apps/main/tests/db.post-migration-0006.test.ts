import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0006 } from "../src/db/post-migrations/0006.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES ('t1','c1','user',0)",
  ).run();
  return db;
};

const insertMessage = (db: Database.Database, id: string, content: string): void => {
  db.prepare(
    "INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, kind, tool_calls_json, created_at) VALUES (?, 't1', 'user', NULL, ?, 'message', NULL, 0)",
  ).run(id, content);
};

describe("postMigration 0006 — backfill messages_fts", () => {
  it("indexes pre-existing messages into messages_fts", () => {
    const db = newDb();
    insertMessage(db, "m1", "kubernetes rollout strategy");
    insertMessage(db, "m2", "unrelated note");
    runPostMigration0006(db);
    const hits = db
      .prepare("SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'kubernetes'")
      .all() as Array<{ message_id: string }>;
    expect(hits.map((h) => h.message_id)).toEqual(["m1"]);
  });

  it("is idempotent — a second run does not duplicate rows", () => {
    const db = newDb();
    insertMessage(db, "m1", "kubernetes rollout strategy");
    runPostMigration0006(db);
    runPostMigration0006(db);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM messages_fts").get() as { n: number }).n;
    expect(count).toBe(1);
  });
});
