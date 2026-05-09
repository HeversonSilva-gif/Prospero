import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (raw: string) => Buffer.from("ENC:" + raw, "utf8"),
    decryptString: (buf: Buffer) => buf.toString("utf8").replace(/^ENC:/, ""),
  },
}));

import { registerAuthHandlers } from "../src/ipc/auth-handlers.js";

const setup = () => {
  handlers.clear();
  const db = new Database(":memory:");
  applyMigrations(db);
  const home = mkdtempSync(join(tmpdir(), "da-home-"));
  registerAuthHandlers(db, () => home);
  return { db, home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

const RAW = "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123";

describe("auth ipc handlers", () => {
  it("auth:token-status returns hasToken=false on empty db", async () => {
    const { cleanup } = setup();
    try {
      const status = await Promise.resolve(handlers.get("auth:token-status")!({}));
      expect(status).toEqual({ hasToken: false });
    } finally {
      cleanup();
    }
  });

  it("auth:token-set persists a valid token and returns redacted status", async () => {
    const { cleanup } = setup();
    try {
      const result = (await Promise.resolve(
        handlers.get("auth:token-set")!({}, { raw: RAW, source: "manual" }),
      )) as { hasToken: true; maskedPrefix: string };
      expect(result.hasToken).toBe(true);
      expect(result.maskedPrefix).toContain("sk-ant-oat");
      expect(result.maskedPrefix).not.toContain("PRODUCTION_TOKEN");
    } finally {
      cleanup();
    }
  });

  it("auth:token-set throws on malformed token", async () => {
    const { cleanup } = setup();
    try {
      await expect(
        Promise.resolve(handlers.get("auth:token-set")!({}, { raw: "garbage", source: "manual" })),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("auth:token-detect returns null when no credentials.json", async () => {
    const { cleanup } = setup();
    try {
      const result = await Promise.resolve(handlers.get("auth:token-detect")!({}));
      expect(result).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("auth:token-detect returns the token when credentials.json present", async () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(
        join(home, ".claude", ".credentials.json"),
        JSON.stringify({ claudeAiOauth: { accessToken: RAW } }),
      );
      const result = await Promise.resolve(handlers.get("auth:token-detect")!({}));
      expect(result).toBe(RAW);
    } finally {
      cleanup();
    }
  });

  it("auth:token-clear removes the token", async () => {
    const { cleanup } = setup();
    try {
      await Promise.resolve(handlers.get("auth:token-set")!({}, { raw: RAW, source: "manual" }));
      await Promise.resolve(handlers.get("auth:token-clear")!({}));
      const status = await Promise.resolve(handlers.get("auth:token-status")!({}));
      expect(status).toEqual({ hasToken: false });
    } finally {
      cleanup();
    }
  });
});
