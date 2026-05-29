import { describe, expect, it, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

// vi.hoisted ensures mockApp is initialised before the vi.mock factory runs
// (vi.mock is hoisted to the top of the compiled output; a plain `const`
// defined above it is NOT available inside the factory — ReferenceError).
const { mockApp } = vi.hoisted(() => ({ mockApp: { isPackaged: false } }));

vi.mock("electron", () => ({
  app: mockApp,
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

// ── SEC-CRIT-02: E2E bypass guard ────────────────────────────────────────────

describe("loadDecryptedToken E2E bypass (SEC-CRIT-02)", () => {
  const TOKEN_FILE_VAR = "PROSPERO_E2E_TOKEN_PATH";
  const originalPath = process.env[TOKEN_FILE_VAR];

  afterEach(() => {
    // Restore env + isPackaged after each test
    if (originalPath !== undefined) process.env[TOKEN_FILE_VAR] = originalPath;
    else delete process.env[TOKEN_FILE_VAR];
    mockApp.isPackaged = false;
  });

  it("bypass is inactive when env var is not set (normal path)", () => {
    delete process.env[TOKEN_FILE_VAR];
    const db = setup();
    // No token in DB → should return null via normal path
    expect(loadDecryptedToken(db)).toBeNull();
  });

  it("bypass returns null in packaged build even when env var is set (SEC-CRIT-02)", () => {
    process.env[TOKEN_FILE_VAR] = "/some/path/token.txt";
    mockApp.isPackaged = true; // simulate production build
    const db = setup();
    // Must NOT read the file — falls through to DB path, returns null (empty DB)
    expect(loadDecryptedToken(db)).toBeNull();
  });

  it("bypass is active in non-packaged build when env var points to existing file", async () => {
    // Write a temp token file and point the env var at it
    const { writeFileSync, unlinkSync, mkdtempSync } = await import("node:fs");
    const path = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(path.join(tmpdir(), "prospero-test-"));
    const tokenFile = path.join(dir, "token.txt");
    const fakeToken = "sk-ant-oat01-fake-e2e-token-xyz"; // gitleaks:allow — test fixture, not a real secret
    writeFileSync(tokenFile, fakeToken + "\n", "utf8");
    process.env[TOKEN_FILE_VAR] = tokenFile;
    mockApp.isPackaged = false; // dev build
    try {
      const db = setup();
      expect(loadDecryptedToken(db)).toBe(fakeToken);
    } finally {
      unlinkSync(tokenFile);
    }
  });
});
