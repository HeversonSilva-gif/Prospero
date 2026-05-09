import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClaudeCliToken } from "../src/auth/token-detect.js";

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "da-home-"));
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
};

describe("detectClaudeCliToken", () => {
  it("returns null when ~/.claude does not exist", () => {
    const { home, cleanup } = setup();
    try {
      expect(detectClaudeCliToken(home)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns null when credentials.json is missing", () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      expect(detectClaudeCliToken(home)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns null when file is not parseable JSON", () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(join(home, ".claude", ".credentials.json"), "garbage");
      expect(detectClaudeCliToken(home)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("extracts a well-formed token when present", () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      const fake = {
        claudeAiOauth: { accessToken: "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123" },
      };
      writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify(fake));
      expect(detectClaudeCliToken(home)).toBe("sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123");
    } finally {
      cleanup();
    }
  });

  it("returns null when the file exists but the token field is missing/malformed", () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ other: 1 }));
      expect(detectClaudeCliToken(home)).toBeNull();
    } finally {
      cleanup();
    }
  });
});
