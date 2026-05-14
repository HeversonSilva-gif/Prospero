import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Stub Electron safeStorage so tests run without an Electron host.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`ENC[${s}]`, "utf8"),
    decryptString: (b: Buffer) => {
      const s = b.toString("utf8");
      const m = /^ENC\[(.*)\]$/.exec(s);
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
  vi.clearAllMocks();
});

describe("api key storage", () => {
  it("saveApiKey persists encrypted blob + masked prefix", async () => {
    const db = setupDb();
    const { saveApiKey, loadApiKeyStatus } = await import("./api-key-storage.js");
    saveApiKey(db, "sk-ant-api03-" + "x".repeat(80));
    const status = loadApiKeyStatus(db);
    expect(status.hasKey).toBe(true);
    if (status.hasKey) {
      expect(status.maskedPrefix).toMatch(/^sk-ant-api/);
      expect(status.maskedPrefix).not.toContain("xxxxxxxx");
      expect(status.configuredAt).toBeGreaterThan(0);
    }
  });

  it("loadApiKeyStatus returns hasKey:false on empty db", async () => {
    const db = setupDb();
    const { loadApiKeyStatus } = await import("./api-key-storage.js");
    expect(loadApiKeyStatus(db)).toEqual({ hasKey: false });
  });

  it("loadDecryptedApiKey returns null when missing", async () => {
    const db = setupDb();
    const { loadDecryptedApiKey } = await import("./api-key-storage.js");
    expect(loadDecryptedApiKey(db)).toBeNull();
  });

  it("loadDecryptedApiKey round-trips through encrypt/decrypt", async () => {
    const db = setupDb();
    const { saveApiKey, loadDecryptedApiKey } = await import("./api-key-storage.js");
    const raw = "sk-ant-api03-" + "y".repeat(80);
    saveApiKey(db, raw);
    expect(loadDecryptedApiKey(db)).toBe(raw);
  });

  it("clearApiKey removes all rows", async () => {
    const db = setupDb();
    const { saveApiKey, clearApiKey, loadApiKeyStatus } = await import("./api-key-storage.js");
    saveApiKey(db, "sk-ant-api03-" + "z".repeat(80));
    clearApiKey(db);
    expect(loadApiKeyStatus(db)).toEqual({ hasKey: false });
  });

  it("saveApiKey rejects malformed input", async () => {
    const db = setupDb();
    const { saveApiKey } = await import("./api-key-storage.js");
    expect(() => saveApiKey(db, "not-a-key")).toThrow(/well-formed/i);
  });
});
