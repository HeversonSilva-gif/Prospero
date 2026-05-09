import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (raw: string) => Buffer.from("ENC:" + raw, "utf8"),
    decryptString: (buf: Buffer) => buf.toString("utf8").replace(/^ENC:/, ""),
  },
}));

import {
  saveToken,
  loadTokenStatus,
  loadDecryptedToken,
  clearToken,
} from "../src/auth/token-storage.js";

const RAW = "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
};

describe("token-storage", () => {
  it("returns empty status on fresh db", () => {
    const db = setup();
    expect(loadTokenStatus(db)).toEqual({ hasToken: false });
  });

  it("encrypts and persists a manual token", () => {
    const db = setup();
    saveToken(db, { raw: RAW, source: "manual" });
    const status = loadTokenStatus(db);
    expect(status.hasToken).toBe(true);
    if (status.hasToken) {
      expect(status.source).toBe("manual");
      expect(status.maskedPrefix.startsWith("sk-ant-oat")).toBe(true);
      expect(status.maskedPrefix).not.toContain("PRODUCTION_TOKEN");
    }
  });

  it("round-trips raw token via loadDecryptedToken", () => {
    const db = setup();
    saveToken(db, { raw: RAW, source: "auto-detect" });
    expect(loadDecryptedToken(db)).toBe(RAW);
  });

  it("clearToken resets status", () => {
    const db = setup();
    saveToken(db, { raw: RAW, source: "manual" });
    clearToken(db);
    expect(loadTokenStatus(db)).toEqual({ hasToken: false });
    expect(loadDecryptedToken(db)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    const db = setup();
    expect(() => saveToken(db, { raw: "not-a-token", source: "manual" })).toThrow();
  });
});
