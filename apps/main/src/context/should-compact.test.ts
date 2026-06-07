import { describe, it, expect } from "vitest";
import { shouldCompact } from "./should-compact.js";

describe("shouldCompact", () => {
  it("true when a warm turn's cache_read exceeds the threshold", () => {
    expect(shouldCompact({ cacheRead: 400_000, cacheCreation: 0 }, 300_000)).toBe(true);
  });

  it("true when a COLD turn's cache_creation exceeds the threshold (cacheRead ~0)", () => {
    // The cold boot turn the old read-only check missed: the big prefix is freshly
    // WRITTEN to cache, so it must still count toward the size signal — otherwise
    // the large session survives to the next (also expensive) cold boot.
    expect(shouldCompact({ cacheRead: 0, cacheCreation: 400_000 }, 300_000)).toBe(true);
  });

  it("sums read + creation against the threshold", () => {
    expect(shouldCompact({ cacheRead: 200_000, cacheCreation: 150_000 }, 300_000)).toBe(true);
  });

  it("false at or below the threshold", () => {
    expect(shouldCompact({ cacheRead: 200_000, cacheCreation: 100_000 }, 300_000)).toBe(false);
  });

  it("false when threshold is 0 (disabled)", () => {
    expect(shouldCompact({ cacheRead: 9_999_999, cacheCreation: 9_999_999 }, 0)).toBe(false);
  });
});
