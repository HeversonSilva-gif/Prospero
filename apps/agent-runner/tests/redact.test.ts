import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/redact.js";

describe("redactSecrets", () => {
  it("masks an Anthropic key", () => {
    const out = redactSecrets("env CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-AbCd1234_efGh");
    expect(out).not.toContain("sk-ant-oat01-AbCd1234_efGh");
    expect(out).toContain("[redacted]");
  });

  it("masks a GitHub token", () => {
    expect(redactSecrets("token gho_AbCd1234EfGh5678IjKl")).toContain("[redacted]");
    expect(redactSecrets("token gho_AbCd1234EfGh5678IjKl")).not.toContain(
      "gho_AbCd1234EfGh5678IjKl",
    );
  });

  it("masks a bearer token but keeps the Bearer prefix", () => {
    expect(redactSecrets("Authorization: Bearer abcdef1234567890")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  it("leaves text without secrets untouched", () => {
    expect(redactSecrets("a plain diagnostic line")).toBe("a plain diagnostic line");
  });
});
