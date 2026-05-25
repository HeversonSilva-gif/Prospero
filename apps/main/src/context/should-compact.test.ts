import { describe, it, expect } from "vitest";
import { shouldCompact } from "./should-compact.js";

describe("shouldCompact", () => {
  it("true when the turn's cache_read exceeds the threshold", () => {
    expect(shouldCompact({ cacheRead: 400_000 }, 300_000)).toBe(true);
  });
  it("false at or below the threshold", () => {
    expect(shouldCompact({ cacheRead: 300_000 }, 300_000)).toBe(false);
  });
  it("false when threshold is 0 (disabled)", () => {
    expect(shouldCompact({ cacheRead: 9_999_999 }, 0)).toBe(false);
  });
});
