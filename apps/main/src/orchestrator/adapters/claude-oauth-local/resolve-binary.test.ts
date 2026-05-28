import { describe, it, expect, vi, afterEach } from "vitest";
import { findClaudeExe, findClaudePosix } from "./resolve-binary.js";

// We test the pure path-scanning logic without real filesystem access by
// mocking existsSync and process.env["PATH"]. The tests run on all platforms
// (the functions guard on process.platform internally).

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from "node:fs";
const mockExists = vi.mocked(existsSync);

describe("findClaudeExe (Windows)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockExists.mockReset();
  });

  it("returns null on non-Windows platforms immediately", () => {
    // On macOS/Linux CI this branch is always taken. On Windows it's tested
    // indirectly via the other cases below (guarded by platform check in impl).
    if (process.platform !== "win32") {
      expect(findClaudeExe()).toBeNull();
    }
  });

  it("returns direct .exe path when found in PATH (Windows)", () => {
    if (process.platform !== "win32") return;
    vi.stubEnv("PATH", "C:\\npm-bin;C:\\Windows\\System32");
    mockExists.mockImplementation((p) => String(p) === "C:\\npm-bin\\claude.exe");
    expect(findClaudeExe()).toBe("C:\\npm-bin\\claude.exe");
  });

  it("falls back to node_modules .exe via .cmd (Windows)", () => {
    if (process.platform !== "win32") return;
    vi.stubEnv("PATH", "C:\\npm-bin;C:\\Windows\\System32");
    mockExists.mockImplementation((p) => {
      const s = String(p);
      if (s === "C:\\npm-bin\\claude.exe") return false;
      if (s === "C:\\npm-bin\\claude.cmd") return true;
      if (s.endsWith("claude.exe") && s.includes("@anthropic-ai")) return true;
      return false;
    });
    const result = findClaudeExe();
    expect(result).not.toBeNull();
    expect(result).toContain("claude.exe");
  });

  it("returns null when neither .exe nor .cmd found (Windows)", () => {
    if (process.platform !== "win32") return;
    vi.stubEnv("PATH", "C:\\Windows\\System32");
    mockExists.mockReturnValue(false);
    expect(findClaudeExe()).toBeNull();
  });
});

describe("findClaudePosix (macOS + Linux)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockExists.mockReset();
  });

  it("returns null on Windows immediately", () => {
    if (process.platform === "win32") {
      expect(findClaudePosix()).toBeNull();
    }
  });

  it("returns absolute path to claude when found in PATH (POSIX)", () => {
    if (process.platform === "win32") return;
    vi.stubEnv("PATH", "/usr/local/bin:/usr/bin:/bin");
    mockExists.mockImplementation((p) => String(p) === "/usr/local/bin/claude");
    expect(findClaudePosix()).toBe("/usr/local/bin/claude");
  });

  it("scans all PATH dirs and returns first match (POSIX)", () => {
    if (process.platform === "win32") return;
    vi.stubEnv("PATH", "/usr/bin:/home/user/.nvm/versions/node/v20/bin:/bin");
    mockExists.mockImplementation(
      (p) => String(p) === "/home/user/.nvm/versions/node/v20/bin/claude",
    );
    expect(findClaudePosix()).toBe("/home/user/.nvm/versions/node/v20/bin/claude");
  });

  it("returns null when claude not found in any PATH dir (POSIX)", () => {
    if (process.platform === "win32") return;
    vi.stubEnv("PATH", "/usr/bin:/bin");
    mockExists.mockReturnValue(false);
    expect(findClaudePosix()).toBeNull();
  });

  it("handles empty PATH gracefully (POSIX)", () => {
    if (process.platform === "win32") return;
    vi.stubEnv("PATH", "");
    mockExists.mockReturnValue(false);
    expect(findClaudePosix()).toBeNull();
  });

  it("uses ':' as PATH separator not ';' (POSIX)", () => {
    if (process.platform === "win32") return;
    // If ';' were used as separator, '/usr/bin:/bin' would be treated as one dir
    // and the mock would never match '/usr/bin/claude'.
    vi.stubEnv("PATH", "/usr/bin:/bin");
    const checkedPaths: string[] = [];
    mockExists.mockImplementation((p) => {
      checkedPaths.push(String(p));
      return false;
    });
    findClaudePosix();
    expect(checkedPaths).toContain("/usr/bin/claude");
    expect(checkedPaths).toContain("/bin/claude");
    // Must NOT contain a path with ':' in it (which would happen with ';' split)
    expect(checkedPaths.every((p) => !p.includes(":"))).toBe(true);
  });
});
