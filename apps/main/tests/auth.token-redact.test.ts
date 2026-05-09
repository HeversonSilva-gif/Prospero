import { describe, expect, it } from "vitest";
import { redactToken, redactString } from "../src/auth/token-redact.js";

describe("redactToken", () => {
  it("masks an OAuth token preserving prefix", () => {
    const t = "sk-ant-oat-FAKEPRODUCTION_TOKEN_VALUE_HERE_xyz";
    expect(redactToken(t)).toBe("sk-ant-oat-...[REDACTED]");
  });

  it("returns empty for empty input", () => {
    expect(redactToken("")).toBe("");
  });

  it("masks even non-prefixed strings", () => {
    expect(redactToken("12345678")).toBe("12...[REDACTED]");
  });
});

describe("redactString", () => {
  it("redacts OAuth-shaped tokens inside larger strings", () => {
    const s = "Authorization: Bearer sk-ant-oat-PRODUCTION_TOKEN_xyz; trailing";
    expect(redactString(s)).toContain("[REDACTED]");
    expect(redactString(s)).not.toContain("PRODUCTION_TOKEN_xyz");
  });

  it("redacts API keys too", () => {
    const s = "key=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(redactString(s)).toContain("[REDACTED]");
  });

  it("passes through clean strings unchanged", () => {
    expect(redactString("plain log line")).toBe("plain log line");
  });
});
