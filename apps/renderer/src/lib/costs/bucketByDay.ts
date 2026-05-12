// Pads zero buckets for missing days in a time range so charts draw a
// continuous line instead of skipping gaps. Input must already be daily-
// bucketed (bucketStart == UTC midnight). Range is [from, to) — half-open.

import type { CostBucket } from "@dashboard-agent/shared";

const DAY_MS = 86_400_000;

const emptyBucket = (bucketStart: number): CostBucket => ({
  bucketStart,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costCents: 0,
});

export const fillMissingDays = (
  buckets: CostBucket[],
  fromMs: number,
  toMs: number,
): CostBucket[] => {
  if (toMs <= fromMs) return [];
  const byStart = new Map<number, CostBucket>(buckets.map((b) => [b.bucketStart, b]));
  const out: CostBucket[] = [];
  for (let t = fromMs; t < toMs; t += DAY_MS) {
    out.push(byStart.get(t) ?? emptyBucket(t));
  }
  return out;
};
