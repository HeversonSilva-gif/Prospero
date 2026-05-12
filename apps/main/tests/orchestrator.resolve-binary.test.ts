import { describe, expect, it } from "vitest";
import { findClaudeExe } from "../src/orchestrator/adapters/claude-oauth-local/resolve-binary.js";

describe("findClaudeExe", () => {
  it("returns null on non-Windows platforms", () => {
    if (process.platform !== "win32") {
      expect(findClaudeExe()).toBeNull();
    }
  });

  it("is callable on Windows without throwing (returns string | null)", () => {
    const result = findClaudeExe();
    expect(result === null || typeof result === "string").toBe(true);
  });
});
