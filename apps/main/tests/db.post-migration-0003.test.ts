import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0003 } from "../src/db/post-migrations/0003.js";

const seedAgent = (db: Database.Database, id: string, sessionId: string | null) => {
  db.prepare(
    `INSERT INTO agents (
      id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
      mode, always_on, status, current_action, claude_session_id, created_at, updated_at
    ) VALUES (?, 'c1', 'X', 'x', '', '[]', '[]', 'supervised', 0, 'idle', NULL, ?, 0, 0)`,
  ).run(id, sessionId);
};

describe("postMigration 0003 — clear stale claude_session_id", () => {
  it("clears existing claude_session_id values", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
    seedAgent(db, "a1", "stale-session-1");
    seedAgent(db, "a2", "stale-session-2");
    seedAgent(db, "a3", null);

    runPostMigration0003(db);

    const rows = db.prepare("SELECT id, claude_session_id FROM agents ORDER BY id").all() as {
      id: string;
      claude_session_id: string | null;
    }[];
    expect(rows).toEqual([
      { id: "a1", claude_session_id: null },
      { id: "a2", claude_session_id: null },
      { id: "a3", claude_session_id: null },
    ]);
  });

  it("sets the done flag in settings", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
    seedAgent(db, "a1", "s1");

    runPostMigration0003(db);

    const flag = db
      .prepare("SELECT value FROM settings WHERE key = 'post_migration_0003_done'")
      .get() as { value: string } | undefined;
    expect(flag).toEqual({ value: "1" });
  });

  it("is idempotent — second run does not clear newly-assigned sessions", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
    seedAgent(db, "a1", "stale-session");

    runPostMigration0003(db);
    // Simulate a fresh session captured after the migration ran.
    db.prepare("UPDATE agents SET claude_session_id = 'new-session' WHERE id = 'a1'").run();

    runPostMigration0003(db);

    const sid = (
      db.prepare("SELECT claude_session_id FROM agents WHERE id = 'a1'").get() as {
        claude_session_id: string;
      }
    ).claude_session_id;
    expect(sid).toBe("new-session");
  });
});
