import { describe, expect, it } from "vitest";
import type { UsageEstimate } from "@prospero/shared";
import { estimateCostCents, MODEL_PRICING } from "./pricing.js";

const sampleUsage: UsageEstimate = {
  input: 1_000_000,
  output: 1_000_000,
  cache_read: 1_000_000,
  cache_creation: 1_000_000,
};

describe("estimateCostCents", () => {
  it("returns 0 for an undefined model", () => {
    expect(estimateCostCents(undefined, sampleUsage)).toBe(0);
  });

  it("returns 0 for an unknown model id", () => {
    expect(estimateCostCents("future-model-x", sampleUsage)).toBe(0);
  });

  it("prices claude-opus-4-7 from nonzero usage", () => {
    expect(estimateCostCents("claude-opus-4-7", sampleUsage)).toBeGreaterThan(0);
  });

  // Audit 2026-06-03 Inteligência & Contexto C2: Opus 4.8 (the CEO model) was
  // missing from MODEL_PRICING → counted as $0 in the ledger.
  it("prices claude-opus-4-8 (nonzero) at the same rate as claude-opus-4-7", () => {
    const estimate48 = estimateCostCents("claude-opus-4-8", sampleUsage);
    expect(estimate48).toBeGreaterThan(0);
    expect(estimate48).toBe(estimateCostCents("claude-opus-4-7", sampleUsage));
  });

  it("mirrors the Opus 4.7 rates for claude-opus-4-8", () => {
    expect(MODEL_PRICING["claude-opus-4-8"]).toEqual(MODEL_PRICING["claude-opus-4-7"]);
  });

  // Review of C2: the CLI may echo a DATED id; pricing must still resolve it,
  // else the CEO's cost stays R$0 in production despite the table entry.
  it("prices a dated opus id (claude-opus-4-8-20260601) like the short id", () => {
    const dated = estimateCostCents("claude-opus-4-8-20260601", sampleUsage);
    expect(dated).toBeGreaterThan(0);
    expect(dated).toBe(estimateCostCents("claude-opus-4-8", sampleUsage));
  });

  it("still prices the intentionally-dated haiku key exactly", () => {
    expect(estimateCostCents("claude-haiku-4-5-20251001", sampleUsage)).toBeGreaterThan(0);
  });
});
