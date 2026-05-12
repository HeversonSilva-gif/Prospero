// Pricing snapshot taken 2026-05-12 from Anthropic's public pricing page.
// Values are USD cents per 1M tokens, INTEGER (no fractional cents) to keep
// math exact in better-sqlite3. Re-validate on each release; the snapshotted
// cost_cents_estimate in cost_events.row preserves history if prices change.
//
// Source numbers (USD per 1M tokens):
//   Opus 4.7    — input $15.00, output $75.00, cacheCreate $18.75, cacheRead $1.50
//   Sonnet 4.6  — input  $3.00, output $15.00, cacheCreate  $3.75, cacheRead $0.30
//   Haiku 4.5   — input  $1.00, output  $5.00, cacheCreate  $1.25, cacheRead $0.10
// Multiplied by 100 → cents per 1M tokens (the units of the table below).

import type { UsageEstimate } from "@dashboard-agent/shared";

export type ModelPricing = {
  in: number;
  out: number;
  cacheCreate: number;
  cacheRead: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": { in: 1500, out: 7500, cacheCreate: 1875, cacheRead: 150 },
  "claude-sonnet-4-6": { in: 300, out: 1500, cacheCreate: 375, cacheRead: 30 },
  "claude-haiku-4-5-20251001": { in: 100, out: 500, cacheCreate: 125, cacheRead: 10 },
};

export const estimateCostCents = (model: string | undefined, usage: UsageEstimate): number => {
  if (model === undefined) return 0;
  const p = MODEL_PRICING[model];
  if (p === undefined) return 0;
  const microCents =
    usage.input * p.in +
    usage.output * p.out +
    usage.cache_creation * p.cacheCreate +
    usage.cache_read * p.cacheRead;
  if (microCents === 0) return 0;
  return Math.ceil(microCents / 1_000_000);
};
