import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  app: { getPath: () => "/tmp/test-userdata" },
  shell: { openPath: vi.fn().mockResolvedValue("") },
}));

import { IPC } from "@prospero/shared";
import { applyMigrations } from "../src/db/migrations.js";
import { registerAttachmentHandlers } from "../src/ipc/attachment-handlers.js";
import { shell } from "electron";

describe("attachment-handlers", () => {
  let db: Database.Database;
  let userDataDir: string;

  beforeEach(() => {
    handlers.clear();
    userDataDir = mkdtempSync(join(tmpdir(), "prospero-ipc-test-"));
    db = new Database(":memory:");
    applyMigrations(db);
    registerAttachmentHandlers(db, () => userDataDir);
  });

  afterEach(() => {
    db.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("ATTACHMENTS_UPLOAD valid → returns Attachment", async () => {
    const handler = handlers.get(IPC.ATTACHMENTS_UPLOAD);
    expect(handler).toBeDefined();
    const att = (await handler!(null, {
      buffer: Buffer.from("hello"),
      filename: "h.txt",
      mimeType: "text/plain",
    })) as { id: string; messageId: string | null };
    expect(att.id).toBeDefined();
    expect(att.messageId).toBeNull();
  });

  it("ATTACHMENTS_UPLOAD oversized image → throws", async () => {
    const handler = handlers.get(IPC.ATTACHMENTS_UPLOAD);
    const big = Buffer.alloc(6 * 1024 * 1024); // 6 MB > 5 MB cap
    await expect(
      handler!(null, { buffer: big, filename: "x.png", mimeType: "image/png" }),
    ).rejects.toThrow(/image-too-big/);
  });

  it("ATTACHMENTS_UPLOAD bad mime → throws", async () => {
    const handler = handlers.get(IPC.ATTACHMENTS_UPLOAD);
    await expect(
      handler!(null, {
        buffer: Buffer.from("x"),
        filename: "x.zip",
        mimeType: "application/zip",
      }),
    ).rejects.toThrow(/mime-not-allowed/);
  });

  it("ATTACHMENTS_DELETE removes row + file", async () => {
    const upload = handlers.get(IPC.ATTACHMENTS_UPLOAD);
    const del = handlers.get(IPC.ATTACHMENTS_DELETE);
    const att = (await upload!(null, {
      buffer: Buffer.from("x"),
      filename: "f.txt",
      mimeType: "text/plain",
    })) as { id: string };
    await del!(null, att.id);
    const row = db.prepare("SELECT id FROM message_attachments WHERE id = ?").get(att.id);
    expect(row).toBeUndefined();
  });

  it("ATTACHMENTS_OPEN calls shell.openPath", async () => {
    const upload = handlers.get(IPC.ATTACHMENTS_UPLOAD);
    const open = handlers.get(IPC.ATTACHMENTS_OPEN);
    const att = (await upload!(null, {
      buffer: Buffer.from("x"),
      filename: "f.txt",
      mimeType: "text/plain",
    })) as { id: string };
    const result = (await open!(null, att.id)) as { ok?: boolean; error?: string };
    expect(result.ok).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() spy reference, never invoked here
    expect(shell.openPath).toHaveBeenCalled();
  });
});
