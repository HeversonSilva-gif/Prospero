import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { registerIpcHandlers } from "../src/ipc/handlers.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  app: {
    getPath: (_name: string) => "/tmp/test-userdata",
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (raw: string) => Buffer.from("ENC:" + raw, "utf8"),
    decryptString: (buf: Buffer) => buf.toString("utf8").replace(/^ENC:/, ""),
  },
}));

describe("registerIpcHandlers", () => {
  it("registers ping handler that returns 'pong'", async () => {
    handlers.clear();
    const db = new Database(":memory:");
    applyMigrations(db);
    registerIpcHandlers(db);
    const ping = handlers.get("ping");
    expect(ping).toBeDefined();
    const result = await Promise.resolve(ping!({}));
    expect(result).toBe("pong");
  });
});
