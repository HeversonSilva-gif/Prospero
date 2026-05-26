import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { persistAttachment } from "./attachments.js";
import { cleanupOrphanAttachments } from "./cleanup.js";

function seedMessageChain(db: Database.Database): void {
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

describe("cleanupOrphanAttachments", () => {
  let userDataDir: string;
  let db: Database.Database;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "prospero-cleanup-test-"));
    db = new Database(":memory:");
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("removes orphans older than 1 hour", async () => {
    const att = await persistAttachment({
      db,
      buffer: Buffer.from("x"),
      filename: "f.txt",
      mimeType: "text/plain",
      messageId: null,
      userDataDir,
    });
    // Pretend it's >1h old
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    db.prepare("UPDATE message_attachments SET created_at = ? WHERE id = ?").run(
      twoHoursAgo,
      att.id,
    );

    const removed = cleanupOrphanAttachments(db);
    expect(removed).toBe(1);
    expect(
      db.prepare("SELECT id FROM message_attachments WHERE id = ?").get(att.id),
    ).toBeUndefined();
  });

  it("does not remove fresh orphans", async () => {
    await persistAttachment({
      db,
      buffer: Buffer.from("x"),
      filename: "f.txt",
      mimeType: "text/plain",
      messageId: null,
      userDataDir,
    });
    const removed = cleanupOrphanAttachments(db);
    expect(removed).toBe(0);
  });

  it("does not remove attachments with messageId set", async () => {
    seedMessageChain(db);

    const att = await persistAttachment({
      db,
      buffer: Buffer.from("x"),
      filename: "f.txt",
      mimeType: "text/plain",
      messageId: "m1",
      userDataDir,
    });
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    db.prepare("UPDATE message_attachments SET created_at = ? WHERE id = ?").run(
      twoHoursAgo,
      att.id,
    );

    const removed = cleanupOrphanAttachments(db);
    expect(removed).toBe(0);
    expect(db.prepare("SELECT id FROM message_attachments WHERE id = ?").get(att.id)).toBeDefined();
  });
});
