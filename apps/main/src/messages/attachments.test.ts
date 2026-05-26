import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import {
  validateAttachment,
  buildContentBlocks,
  persistAttachment,
  loadAttachment,
  deleteAttachment,
  MAX_IMAGE_BYTES,
  MAX_OTHER_BYTES,
} from "./attachments.js";

describe("validateAttachment", () => {
  it("accepts a small PNG", () => {
    const buf = Buffer.alloc(100);
    expect(validateAttachment(buf, "image/png")).toEqual({ ok: true });
  });

  it("rejects image larger than 5 MB", () => {
    const buf = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    expect(validateAttachment(buf, "image/jpeg")).toEqual({
      ok: false,
      reason: "image-too-big",
    });
  });

  it("accepts PDF up to 20 MB", () => {
    const buf = Buffer.alloc(MAX_OTHER_BYTES);
    expect(validateAttachment(buf, "application/pdf")).toEqual({ ok: true });
  });

  it("rejects PDF over 20 MB", () => {
    const buf = Buffer.alloc(MAX_OTHER_BYTES + 1);
    expect(validateAttachment(buf, "application/pdf")).toEqual({
      ok: false,
      reason: "file-too-big",
    });
  });

  it("rejects empty buffer", () => {
    expect(validateAttachment(Buffer.alloc(0), "image/png")).toEqual({
      ok: false,
      reason: "empty-buffer",
    });
  });

  it("rejects unknown mime types", () => {
    const buf = Buffer.alloc(100);
    expect(validateAttachment(buf, "application/zip")).toEqual({
      ok: false,
      reason: "mime-not-allowed",
    });
  });

  it("accepts text/plain, text/markdown, application/json", () => {
    const buf = Buffer.alloc(100);
    expect(validateAttachment(buf, "text/plain").ok).toBe(true);
    expect(validateAttachment(buf, "text/markdown").ok).toBe(true);
    expect(validateAttachment(buf, "application/json").ok).toBe(true);
  });
});

describe("buildContentBlocks", () => {
  it("returns single text block when no attachments", () => {
    const blocks = buildContentBlocks("hello", []);
    expect(blocks).toEqual([{ type: "text", text: "hello" }]);
  });

  it("encodes an image as base64 image block", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const blocks = buildContentBlocks("look", [
      { filename: "a.png", mimeType: "image/png", buffer },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: "look" });
    expect(blocks[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: buffer.toString("base64") },
    });
  });

  it("encodes a PDF as document block", () => {
    const buffer = Buffer.from("%PDF-1.7");
    const blocks = buildContentBlocks("see this", [
      { filename: "doc.pdf", mimeType: "application/pdf", buffer },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: buffer.toString("base64"),
      },
    });
  });

  it("inlines text/plain as text appended to first block", () => {
    const buffer = Buffer.from("console error here\nstack 1\nstack 2");
    const blocks = buildContentBlocks("Olha o log:", [
      { filename: "log.txt", mimeType: "text/plain", buffer },
    ]);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { type: "text"; text: string }).text).toContain("Olha o log:");
    expect((blocks[0] as { type: "text"; text: string }).text).toContain("log.txt");
    expect((blocks[0] as { type: "text"; text: string }).text).toContain("console error here");
  });

  it("preserves order with mixed attachments", () => {
    const img = Buffer.from([0x01]);
    const pdf = Buffer.from([0x02]);
    const txt = Buffer.from("hello");
    const blocks = buildContentBlocks("Q:", [
      { filename: "a.png", mimeType: "image/png", buffer: img },
      { filename: "b.pdf", mimeType: "application/pdf", buffer: pdf },
      { filename: "c.txt", mimeType: "text/plain", buffer: txt },
    ]);
    // text block (with c.txt inlined) + image + document
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.type).toBe("text");
    expect(blocks[1]?.type).toBe("image");
    expect(blocks[2]?.type).toBe("document");
  });
});

describe("persistAttachment / loadAttachment / deleteAttachment", () => {
  let userDataDir: string;
  let db: Database.Database;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "prospero-attach-test-"));
    db = new Database(":memory:");
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("persists pending attachment to disk + DB", async () => {
    const buf = Buffer.from("hello");
    const att = await persistAttachment({
      db,
      buffer: buf,
      filename: "hello.txt",
      mimeType: "text/plain",
      messageId: null,
      userDataDir,
    });

    expect(att.id).toBeDefined();
    expect(att.messageId).toBeNull();
    expect(att.filename).toBe("hello.txt");
    expect(att.sizeBytes).toBe(5);

    const row = db
      .prepare("SELECT local_path FROM message_attachments WHERE id = ?")
      .get(att.id) as { local_path: string };
    expect(existsSync(row.local_path)).toBe(true);
    expect(readFileSync(row.local_path).toString()).toBe("hello");
    // pending uploads land in /attachments/pending/<id>/<filename>
    expect(row.local_path).toContain("pending");
  });

  it("loadAttachment returns buffer", async () => {
    const buf = Buffer.from("payload");
    const att = await persistAttachment({
      db,
      buffer: buf,
      filename: "f.txt",
      mimeType: "text/plain",
      messageId: null,
      userDataDir,
    });
    const loaded = loadAttachment(att.id, db);
    expect(loaded?.toString()).toBe("payload");
  });

  it("loadAttachment returns null for missing file (tampering)", async () => {
    const att = await persistAttachment({
      db,
      buffer: Buffer.from("x"),
      filename: "f.txt",
      mimeType: "text/plain",
      messageId: null,
      userDataDir,
    });
    const row = db
      .prepare("SELECT local_path FROM message_attachments WHERE id = ?")
      .get(att.id) as { local_path: string };
    rmSync(row.local_path); // simulate tamper
    expect(loadAttachment(att.id, db)).toBeNull();
  });

  it("deleteAttachment removes file and row", async () => {
    const att = await persistAttachment({
      db,
      buffer: Buffer.from("x"),
      filename: "f.txt",
      mimeType: "text/plain",
      messageId: null,
      userDataDir,
    });
    deleteAttachment(att.id, db);

    const row = db.prepare("SELECT * FROM message_attachments WHERE id = ?").get(att.id);
    expect(row).toBeUndefined();
  });

  it("deleteAttachment is idempotent (already deleted = no throw)", () => {
    expect(() => deleteAttachment("nonexistent", db)).not.toThrow();
  });
});
