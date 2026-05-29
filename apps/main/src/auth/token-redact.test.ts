import { describe, it, expect } from "vitest";
import { redactString, redactToken } from "./token-redact.js";

describe("redactString", () => {
  it("redacts oauth sk-ant-oat tokens", () => {
    const out = redactString("token=sk-ant-oat-FAKE_OAUTH_TOKEN_VALUE_FOR_TEST");
    expect(out).not.toContain("FAKE_OAUTH_TOKEN_VALUE");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts api03 keys", () => {
    const key = "sk-ant-api03-" + "A".repeat(60);
    const out = redactString(`key=${key}`);
    expect(out).not.toContain("AAAA");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts a generic sk-ant key (>=8 chars)", () => {
    const out = redactString("sk-ant-deadbeef12345");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("deadbeef");
  });

  it("redacts Bearer tokens", () => {
    const out = redactString("Authorization: Bearer abc123.def456-ghi789");
    expect(out).toContain("Bearer [REDACTED]");
    expect(out).not.toContain("abc123.def456");
  });

  it("redacts GitHub tokens", () => {
    const out = redactString("GH=ghp_FAKEtoken0123456789abcd");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("FAKEtoken0123456789");
  });

  it("redacts ANTHROPIC_API_KEY env assignments", () => {
    const out = redactString("ANTHROPIC_API_KEY=sk-ant-api03-secretvalue123456");
    expect(out).toContain("ANTHROPIC_API_KEY=[REDACTED]");
    expect(out).not.toContain("secretvalue");
  });

  it("redacts CLAUDE_CODE_OAUTH_TOKEN env assignments", () => {
    const out = redactString("CLAUDE_CODE_OAUTH_TOKEN=someopaquevalue");
    expect(out).toContain("CLAUDE_CODE_OAUTH_TOKEN=[REDACTED]");
    expect(out).not.toContain("someopaquevalue");
  });

  it("redacts ANTHROPIC_AUTH_TOKEN env assignments", () => {
    const out = redactString("ANTHROPIC_AUTH_TOKEN=anothersecret");
    expect(out).toContain("ANTHROPIC_AUTH_TOKEN=[REDACTED]");
    expect(out).not.toContain("anothersecret");
  });

  it("leaves benign strings unchanged", () => {
    const benign = "spawn claude for agent=abc-123 cwd=/work/project";
    expect(redactString(benign)).toBe(benign);
  });
});

describe("redactToken", () => {
  it("masks a long token keeping a short prefix", () => {
    const out = redactToken("sk-ant-oat-FAKE_LONG_TOKEN_VALUE");
    expect(out).toContain("...[REDACTED]");
    expect(out).not.toContain("FAKE_LONG_TOKEN_VALUE");
  });

  it("returns empty for empty", () => {
    expect(redactToken("")).toBe("");
  });
});
