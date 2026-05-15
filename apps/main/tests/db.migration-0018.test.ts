import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

const tableNames = (db: Database.Database): string[] =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);

const columnNames = (db: Database.Database, table: string): string[] =>
  (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

describe("migration 0018 — M11 memory & skills schema", () => {
  it("creates skills, memories, skill_candidates tables", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const names = tableNames(db);
    expect(names).toContain("skills");
    expect(names).toContain("memories");
    expect(names).toContain("skill_candidates");
  });

  it("creates memories_fts and messages_fts FTS5 virtual tables", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    // A query against an FTS5 table that does not exist throws.
    expect(() => db.prepare("SELECT * FROM memories_fts").all()).not.toThrow();
    expect(() => db.prepare("SELECT * FROM messages_fts").all()).not.toThrow();
  });

  it("memories has source_event_id and pinned columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnNames(db, "memories");
    expect(cols).toContain("source_event_id");
    expect(cols).toContain("pinned");
    expect(cols).toContain("importance");
  });

  it("skills enforces the source CHECK constraint", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    const insert = db.prepare(
      `INSERT INTO skills (id, company_id, agent_id, name, body_path, description, source, created_at)
       VALUES (?, 'c1', NULL, 'n', 'p', 'd', ?, 0)`,
    );
    expect(() => insert.run("s_bad", "not_a_valid_source")).toThrow();
    expect(() => insert.run("s_ok", "user_authored")).not.toThrow();
  });

  it("memories_fts MATCH search works after a manual insert", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      "INSERT INTO memories_fts (memory_id, body) VALUES ('m1', 'deploy via docker compose')",
    ).run();
    const hits = db
      .prepare("SELECT memory_id FROM memories_fts WHERE memories_fts MATCH 'docker'")
      .all() as Array<{ memory_id: string }>;
    expect(hits.map((h) => h.memory_id)).toEqual(["m1"]);
  });
});
