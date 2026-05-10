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

  it("auth:token-detect returns { found: false } when no credentials.json", async () => {
    const { cleanup } = setup();
    try {
      const result = await Promise.resolve(handlers.get("auth:token-detect")!({}));
      expect(result).toEqual({ found: false });
    } finally {
      cleanup();
    }
  });

  it("auth:token-detect returns ONLY a masked prefix — never the raw token (SEC-01)", async () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(
        join(home, ".claude", ".credentials.json"),
        JSON.stringify({ claudeAiOauth: { accessToken: RAW } }),
      );
      const result = (await Promise.resolve(handlers.get("auth:token-detect")!({}))) as {
        found: true;
        maskedPrefix: string;
      };
      expect(result.found).toBe(true);
      expect(result.maskedPrefix).toContain("sk-ant-oat");
      // The raw token must NEVER be in the IPC response
      expect(JSON.stringify(result)).not.toContain("PRODUCTION_TOKEN");
      expect(JSON.stringify(result)).not.toContain(RAW);
    } finally {
      cleanup();
    }
  });

  it("auth:token-import-detected re-detects + saves and returns status", async () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(
        join(home, ".claude", ".credentials.json"),
        JSON.stringify({ claudeAiOauth: { accessToken: RAW } }),
      );
      const status = (await Promise.resolve(handlers.get("auth:token-import-detected")!({}))) as {
        hasToken: true;
        source: string;
        maskedPrefix: string;
      };
      expect(status.hasToken).toBe(true);
      expect(status.source).toBe("auto-detect");
      expect(status.maskedPrefix).toContain("sk-ant-oat");
      // Raw token still must not leak in the resulting status
      expect(JSON.stringify(status)).not.toContain("PRODUCTION_TOKEN");
    } finally {
      cleanup();
    }
  });

  it("auth:token-import-detected throws when nothing is detectable", async () => {
    const { cleanup } = setup();
    try {
      await expect(
        Promise.resolve(handlers.get("auth:token-import-detected")!({})),
      ).rejects.toThrow();
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
