import { describe, it, expect } from "vitest";
import { toFtsMatchExpr } from "./fts-query.js";

describe("toFtsMatchExpr", () => {
  it("wraps each whitespace-separated token in double quotes", () => {
    expect(toFtsMatchExpr("docker compose")).toBe('"docker" "compose"');
  });

  it("escapes embedded double-quote chars", () => {
    expect(toFtsMatchExpr('say "hello"')).toBe('"say" """hello"""');
  });

  it("returns empty string for blank/whitespace-only input", () => {
    expect(toFtsMatchExpr("")).toBe("");
    expect(toFtsMatchExpr("   ")).toBe("");
  });

  it("handles FTS operators as literal tokens (quotes neutralize them)", () => {
    expect(toFtsMatchExpr("docker:*")).toBe('"docker:*"');
    expect(toFtsMatchExpr("foo -bar")).toBe('"foo" "-bar"');
    expect(toFtsMatchExpr("a OR b")).toBe('"a" "OR" "b"');
    expect(toFtsMatchExpr("(test)")).toBe('"(test)"');
    expect(toFtsMatchExpr("^anchor")).toBe('"^anchor"');
  });

  it("trims leading and trailing whitespace before splitting", () => {
    expect(toFtsMatchExpr("  trim me  ")).toBe('"trim" "me"');
  });

  it("collapses multiple spaces between tokens", () => {
    expect(toFtsMatchExpr("a   b")).toBe('"a" "b"');
  });

  it("single token stays as one quoted term", () => {
    expect(toFtsMatchExpr("redis")).toBe('"redis"');
  });
});
