import { describe, expect, it } from "vitest";
import type { CostBucket } from "@prospero/shared";
import { fillMissingDays } from "./bucketByDay.js";

const bucket = (start: number, tokens: number): CostBucket => ({
  bucketStart: start,
  inputTokens: tokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costCents: 0,
});

describe("fillMissingDays", () => {
  it("inserts zero buckets between existing days", () => {
    const day0 = Date.UTC(2026, 4, 10);
    const day2 = Date.UTC(2026, 4, 12);
    const input = [bucket(day0, 100), bucket(day2, 200)];
    const out = fillMissingDays(input, day0, day2 + 86_400_000);
    expect(out).toHaveLength(3);
    expect(out[0]?.bucketStart).toBe(day0);
    expect(out[0]?.inputTokens).toBe(100);
    expect(out[1]?.bucketStart).toBe(Date.UTC(2026, 4, 11));
    expect(out[1]?.inputTokens).toBe(0);
    expect(out[2]?.bucketStart).toBe(day2);
    expect(out[2]?.inputTokens).toBe(200);
  });

  it("returns empty when from === to", () => {
    const day = Date.UTC(2026, 4, 10);
    const out = fillMissingDays([], day, day);
    expect(out).toEqual([]);
  });

  it("pads zeros when input is empty but range is non-empty", () => {
    const from = Date.UTC(2026, 4, 10);
    const to = Date.UTC(2026, 4, 13);
    const out = fillMissingDays([], from, to);
    expect(out).toHaveLength(3);
    expect(out.every((b) => b.inputTokens === 0 && b.costCents === 0)).toBe(true);
  });

  it("preserves cache + cost fields from input buckets", () => {
    const day = Date.UTC(2026, 4, 10);
    const input = [
      {
        bucketStart: day,
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 1000,
        cacheReadTokens: 200,
        costCents: 5,
      },
    ];
    const out = fillMissingDays(input, day, day + 86_400_000);
    expect(out[0]?.cacheCreationTokens).toBe(1000);
    expect(out[0]?.cacheReadTokens).toBe(200);
    expect(out[0]?.costCents).toBe(5);
  });
});
