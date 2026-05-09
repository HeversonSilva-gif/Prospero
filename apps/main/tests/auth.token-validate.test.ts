import { describe, expect, it } from "vitest";
import { isWellFormedToken } from "../src/auth/token-validate.js";

describe("isWellFormedToken", () => {
  it("accepts an OAuth-shaped token", () => {
    expect(isWellFormedToken("sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isWellFormedToken("")).toBe(false);
  });

  it("rejects a too-short token", () => {
    expect(isWellFormedToken("sk-ant-oat-abc")).toBe(false);
  });

  it("rejects a non-OAuth-shaped string", () => {
    expect(isWellFormedToken("not-a-token")).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isWellFormedToken("  sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123  ")).toBe(true);
  });
});
