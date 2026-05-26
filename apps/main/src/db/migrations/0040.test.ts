import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

function seedFixtures(db: Database.Database): void {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Co', 0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1', 'c1', 'Alice', 'engineer', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO threads (id, company_id, participants_json, created_at)
     VALUES ('t1', 'c1', '[]', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, created_at)
     VALUES ('m1', 't1', 'user', NULL, 'hi', 0)`,
  ).run();
}

describe("migration 0040 — message_attachments", () => {
  it("creates the message_attachments table with FK cascade", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedFixtures(db);

    const insert = db.prepare(`
      INSERT INTO message_attachments
        (id, message_id, filename, mime_type, size_bytes, local_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run("at1", "m1", "f.png", "image/png", 1024, "/tmp/f.png", 0);

    const row = db.prepare("SELECT * FROM message_attachments WHERE id = ?").get("at1") as {
      message_id: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
      local_path: string;
    };
    expect(row.message_id).toBe("m1");
    expect(row.filename).toBe("f.png");
    expect(row.mime_type).toBe("image/png");
    expect(row.size_bytes).toBe(1024);
    expect(row.local_path).toBe("/tmp/f.png");

    // Cascade: deleting the message drops the attachment
    db.prepare("PRAGMA foreign_keys = ON").run();
    db.prepare("DELETE FROM messages WHERE id = ?").run("m1");
    const after = db.prepare("SELECT id FROM message_attachments WHERE id = ?").get("at1");
    expect(after).toBeUndefined();

    db.close();
  });

  it("allows NULL message_id for pending uploads", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      `
      INSERT INTO message_attachments
        (id, message_id, filename, mime_type, size_bytes, local_path, created_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?)
    `,
    ).run("at-pending", "p.txt", "text/plain", 100, "/tmp/p.txt", 0);

    const row = db
      .prepare("SELECT message_id FROM message_attachments WHERE id = ?")
      .get("at-pending") as { message_id: string | null };
    expect(row.message_id).toBeNull();

    db.close();
  });
});
