import { describe, expect, it, beforeEach, vi } from "vitest";

// Controllable safeStorage availability — flipped per test. Hoisted so the
// vi.mock factory (also hoisted) can close over it.
const state = vi.hoisted(() => ({ available: true }));

vi.mock("electron", () => ({
  ipcMain: { handle: () => {}, on: () => {} },
  shell: { openExternal: () => Promise.resolve() },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from(`ENC[${s}]`, "utf8"),
    decryptString: (b: Buffer) => {
      const m = /^ENC\[(.*)\]$/.exec(b.toString("utf8"));
      return m ? m[1] : "";
    },
  },
}));

beforeEach(() => {
  state.available = true;
});

describe("safeStorageCipher", () => {
  it("round-trips a connector secret when OS encryption is available", async () => {
    const { safeStorageCipher } = await import("./connections-handlers.js");
    const cipher = safeStorageCipher();
    const stored = cipher.encrypt("rk_live_secret");
    expect(stored).not.toContain("rk_live_secret"); // stored form is encrypted
    expect(cipher.decrypt(stored)).toBe("rk_live_secret");
  });

  it("refuses to store a secret when OS encryption is unavailable (audit 2026-06-03 I1)", async () => {
    state.available = false;
    const { safeStorageCipher } = await import("./connections-handlers.js");
    expect(() => safeStorageCipher().encrypt("rk_live_secret")).toThrow(
      /encryption is not available/i,
    );
  });
});
