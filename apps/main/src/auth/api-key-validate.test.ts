import { describe, expect, it } from "vitest";
import { isWellFormedApiKey } from "./api-key-validate.js";

describe("isWellFormedApiKey", () => {
  it("accepts valid sk-ant-api keys", () => {
    expect(isWellFormedApiKey("sk-ant-api03-abc123_-XYZ" + "0".repeat(80))).toBe(true);
  });

  it("rejects empty / whitespace", () => {
    expect(isWellFormedApiKey("")).toBe(false);
    expect(isWellFormedApiKey("   ")).toBe(false);
  });

  it("rejects OAuth tokens", () => {
    expect(isWellFormedApiKey("sk-ant-oat-" + "x".repeat(80))).toBe(false);
  });

  it("rejects keys with shell metacharacters", () => {
    expect(isWellFormedApiKey("sk-ant-api03-abc; rm -rf /")).toBe(false);
  });

  it("trims input before validation", () => {
    expect(isWellFormedApiKey("  sk-ant-api03-" + "a".repeat(80) + "  ")).toBe(true);
  });
});
