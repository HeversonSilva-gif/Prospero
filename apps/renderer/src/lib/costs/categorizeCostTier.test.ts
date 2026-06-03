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

  // Audit 2026-06-03 Inteligência & Contexto M3: Opus 4.8 (the CEO model) had
  // no chip entry → the most expensive model showed the weakest cost signal.
  it("returns the same tier for opus 4.8 as opus 4.7", () => {
    expect(categorizeCostTier("claude-opus-4-8").tier).toBe(
      categorizeCostTier("claude-opus-4-7").tier,
    );
    expect(categorizeCostTier("claude-opus-4-8").tier).toBe("expensive");
  });

  it("returns 'expensive' for a dated opus 4.8 id (CLI may echo a date suffix)", () => {
    expect(categorizeCostTier("claude-opus-4-8-20260601").tier).toBe("expensive");
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
