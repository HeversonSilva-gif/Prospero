import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown): void => {
      handlers.set(ch, fn);
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`ENC[${s}]`, "utf8"),
    decryptString: (b: Buffer) => {
      const m = /^ENC\[(.*)\]$/.exec(b.toString("utf8"));
      return m ? m[1] : "";
    },
  },
}));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

beforeEach(() => {
  handlers.clear();
});

describe("auth api-key handlers", () => {
  it("auth:api-key-set persists + returns status with hasKey:true", async () => {
    const db = setupDb();
    const { registerAuthHandlers } = await import("./auth-handlers.js");
    registerAuthHandlers(db);
    const handle = handlers.get("auth:api-key-set");
    expect(handle).toBeDefined();
    const raw = "sk-ant-api03-" + "x".repeat(80);
    const status = (await handle!(null, { raw })) as { hasKey: boolean };
    expect(status.hasKey).toBe(true);
  });

  it("auth:api-key-set rejects malformed input", async () => {
    const db = setupDb();
    const { registerAuthHandlers } = await import("./auth-handlers.js");
    registerAuthHandlers(db);
    const handle = handlers.get("auth:api-key-set");
    await expect(handle!(null, { raw: "not-a-key" })).rejects.toThrow(/well-formed/i);
  });

  it("auth:api-key-status returns hasKey:false when none set", async () => {
    const db = setupDb();
    const { registerAuthHandlers } = await import("./auth-handlers.js");
    registerAuthHandlers(db);
    const handle = handlers.get("auth:api-key-status");
    const status = await handle!(null, undefined);
    expect(status).toEqual({ hasKey: false });
  });

  it("auth:api-key-clear removes the stored key", async () => {
    const db = setupDb();
    const { registerAuthHandlers } = await import("./auth-handlers.js");
    registerAuthHandlers(db);
    const setHandle = handlers.get("auth:api-key-set");
    const clearHandle = handlers.get("auth:api-key-clear");
    await setHandle!(null, { raw: "sk-ant-api03-" + "x".repeat(80) });
    const status = (await clearHandle!(null, undefined)) as { hasKey: boolean };
    expect(status.hasKey).toBe(false);
  });
});
