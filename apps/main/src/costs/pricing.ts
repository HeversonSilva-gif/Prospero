// Pricing snapshot taken 2026-05-12 from Anthropic's public pricing page,
// CORRECTED 2026-06-04 (iss_6ee07913). The 2026-05-12 snapshot mis-seeded Opus
// at $15/$75 — that is the DEPRECATED Opus 4.1/4 rate. The official page
// (platform.claude.com/docs/en/about-claude/pricing, verified 2026-06-04, incl.
// Anthropic's own worked example for Opus 4.8) lists Opus 4.5–4.8 at $5/$25.
// Leaving the stale rate would bill Opus at 3× real cost, and since the
// cost-plus true-up reads cost_events, it would overcharge customers 3× on Opus.
// Values are USD cents per 1M tokens, INTEGER (no fractional cents) to keep
// math exact in better-sqlite3. Re-validate on each release; the snapshotted
// cost_cents_estimate in cost_events.row preserves history if prices change.
//
// Source numbers (USD per 1M tokens):
//   Opus 4.7/4.8 — input  $5.00, output $25.00, cacheCreate  $6.25, cacheRead $0.50
//   Sonnet 4.6   — input  $3.00, output $15.00, cacheCreate  $3.75, cacheRead $0.30
//   Haiku 4.5    — input  $1.00, output  $5.00, cacheCreate  $1.25, cacheRead $0.10
// Multiplied by 100 → cents per 1M tokens (the units of the table below).
// (Opus cacheCreate $6.25 = 1.25× input is the 5-min-write rate; the 1h-write
// rate $10 is a separate TTL not modeled here.)

import type { UsageEstimate } from "@prospero/shared";

export type ModelPricing = {
  in: number;
  out: number;
  cacheCreate: number;
  cacheRead: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": { in: 500, out: 2500, cacheCreate: 625, cacheRead: 50 },
  // Audit 2026-06-03 Inteligência & Contexto C2: Opus 4.8 (the CEO model) was
  // absent → unknown model → $0 in the ledger. Same Opus tier as 4.7.
  // CORRECTED 2026-06-04 (iss_3dfd6d0d): values now match the corrected header
  // ($5/$25 = 500/2500 cents). The prior fix (iss_6ee07913) updated only the
  // comment and left the table at the deprecated $15/$75 → 3× Opus overcharge.
  "claude-opus-4-8": { in: 500, out: 2500, cacheCreate: 625, cacheRead: 50 },
  "claude-sonnet-4-6": { in: 300, out: 1500, cacheCreate: 375, cacheRead: 30 },
  "claude-haiku-4-5-20251001": { in: 100, out: 500, cacheCreate: 125, cacheRead: 10 },
};

// Audit 2026-06-03 Inteligência & Contexto C2 (review): the Anthropic CLI can
// echo a DATED model id (e.g. claude-opus-4-8-20260601) in its result event,
// while our table keys the short id (claude-opus-4-8). Resolve exact first, then
// retry with a trailing -YYYYMMDD date suffix stripped — so a dated opus matches
// the short entry, while the intentionally-dated haiku key still hits exactly.
// Otherwise the priciest model would silently stay R$0 in production.
export const resolveModelPricing = (model: string): ModelPricing | undefined =>
  MODEL_PRICING[model] ?? MODEL_PRICING[model.replace(/-\d{8}$/, "")];

export const estimateCostCents = (model: string | undefined, usage: UsageEstimate): number => {
  if (model === undefined) return 0;
  const p = resolveModelPricing(model);
  if (p === undefined) return 0;
  const microCents =
    usage.input * p.in +
    usage.output * p.out +
    usage.cache_creation * p.cacheCreate +
    usage.cache_read * p.cacheRead;
  if (microCents === 0) return 0;
  return Math.ceil(microCents / 1_000_000);
};
