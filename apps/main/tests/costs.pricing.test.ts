import { describe, expect, it } from "vitest";
import { estimateCostCents, MODEL_PRICING } from "../src/costs/pricing.js";

describe("estimateCostCents", () => {
  it("returns 0 for unknown model", () => {
    expect(
      estimateCostCents("not-a-model", {
        input: 1000,
        output: 500,
        cache_creation: 0,
        cache_read: 0,
      }),
    ).toBe(0);
  });

  it("returns 0 for undefined model", () => {
    expect(
      estimateCostCents(undefined, {
        input: 1000,
        output: 500,
        cache_creation: 0,
        cache_read: 0,
      }),
    ).toBe(0);
  });

  it("estimates sonnet 4.6 cost correctly", () => {
    const cents = estimateCostCents("claude-sonnet-4-6", {
      input: 1_000_000,
      output: 1_000_000,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(1800);
  });

  it("estimates opus 4.7 cost correctly", () => {
    // Opus oficial 2026-06: $5/MTok input (500 cents). O valor antigo 1500
    // ($15) era a tarifa do Opus 4.1/4 DEPRECADO — overcharge 3x (iss_3dfd6d0d).
    const cents = estimateCostCents("claude-opus-4-7", {
      input: 1_000_000,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(500);
  });

  it("estimates opus 4.8 (modelo do CEO) cost correctly — $5/$25", () => {
    // Trava 4.8 explicitamente: era o modelo em produção cobrado 3x a mais.
    const cents = estimateCostCents("claude-opus-4-8", {
      input: 1_000_000,
      output: 1_000_000,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(500 + 2500);
  });

  it("includes cache creation + cache read tokens", () => {
    const cents = estimateCostCents("claude-sonnet-4-6", {
      input: 0,
      output: 0,
      cache_creation: 1_000_000,
      cache_read: 1_000_000,
    });
    expect(cents).toBe(375 + 30);
  });

  it("ceils sub-cent totals (never rounds down to 0)", () => {
    const cents = estimateCostCents("claude-haiku-4-5-20251001", {
      input: 1,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(1);
  });

  it("returns 0 when usage is all zero (no ceil)", () => {
    const cents = estimateCostCents("claude-sonnet-4-6", {
      input: 0,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(0);
  });

  it("MODEL_PRICING covers opus/sonnet/haiku 4.x", () => {
    expect(MODEL_PRICING["claude-opus-4-7"]).toBeDefined();
    expect(MODEL_PRICING["claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-haiku-4-5-20251001"]).toBeDefined();
  });
});
