import { describe, expect, it } from "vitest";
import { categorizeCostTier } from "./categorizeCostTier.js";

describe("categorizeCostTier", () => {
  it("returns 'cheap' for haiku", () => {
    expect(categorizeCostTier("claude-haiku-4-5-20251001").tier).toBe("cheap");
  });

  it("returns 'medium' for sonnet", () => {
    expect(categorizeCostTier("claude-sonnet-4-6").tier).toBe("medium");
  });

  it("returns 'expensive' for opus", () => {
    expect(categorizeCostTier("claude-opus-4-7").tier).toBe("expensive");
  });

  it("returns 'unknown' for unmapped model id", () => {
    expect(categorizeCostTier("future-model-x").tier).toBe("unknown");
  });

  it("returns 'unknown' for empty string", () => {
    expect(categorizeCostTier("").tier).toBe("unknown");
  });

  it("includes the symbol for known tiers", () => {
    expect(categorizeCostTier("claude-haiku-4-5-20251001").symbol).toBe("$");
    expect(categorizeCostTier("claude-sonnet-4-6").symbol).toBe("$$");
    expect(categorizeCostTier("claude-opus-4-7").symbol).toBe("$$$");
  });

  it("returns no symbol for unknown tier", () => {
    expect(categorizeCostTier("foo").symbol).toBe("");
  });
});
