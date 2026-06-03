import type Database from "better-sqlite3";
import type { FinanceSummary, FinanceTopProduct, FinanceMonth } from "@prospero/shared";
import { createStripePaymentsRepository } from "./stripe-payments-repository.js";
import { createStripeSubscriptionsRepository } from "./stripe-subscriptions-repository.js";
import { createCostsRepository } from "../costs/repository.js";

// Pure read-model for the Financeiro panorama (v0.2.8): crosses Stripe payments +
// subscriptions + Claude cost into one summary. Takes `db` (no electron) and `now` so it
// is fully unit-testable. All revenue is NET (refunds/disputes subtracted upstream).
//
// Multi-currency note: KPI cards report a single PRIMARY currency (the one with the most
// lifetime revenue) to stay legible; revenueByCurrency keeps the full breakdown.
// The FinanceSummary wire shape lives in @prospero/shared (used by the IPC + renderer).

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

// Normalize a per-interval price to a monthly figure for MRR.
const toMonthlyCents = (amount: number, interval: string): number => {
  switch (interval) {
    case "year":
      return Math.round(amount / 12);
    case "week":
      return Math.round((amount * 52) / 12);
    case "day":
      return Math.round((amount * 365) / 12);
    default:
      return amount; // month (and anything unexpected) ⇒ as-is
  }
};

const monthKey = (ms: number): string => {
  const d = new Date(ms);
  const m = d.getUTCMonth() + 1;
  return `${String(d.getUTCFullYear())}-${m < 10 ? "0" : ""}${String(m)}`;
};

// The 12 month keys ending at `now` (oldest first).
const last12Months = (now: number): string[] => {
  const base = new Date(now);
  const keys: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    keys.push(monthKey(d.getTime()));
  }
  return keys;
};

export const computeFinanceSummary = (
  db: Database.Database,
  companyId: string,
  opts: { now: number; windowMs: number },
): FinanceSummary => {
  const { now, windowMs } = opts;
  const windowStart = now - windowMs;
  const payments = createStripePaymentsRepository(db).listByCompany(companyId, 0);
  const subs = createStripeSubscriptionsRepository(db).listByCompany(companyId);
  const costCents = createCostsRepository(db).getCompanyTotalSince(companyId, windowStart).cents;

  const net = (p: { amount: number; amountRefunded: number }): number =>
    p.amount - p.amountRefunded;

  // Lifetime net revenue per currency → primary currency.
  const revenueByCurrency: Record<string, number> = {};
  for (const p of payments) {
    revenueByCurrency[p.currency] = (revenueByCurrency[p.currency] ?? 0) + net(p);
  }
  let currency = "brl";
  let best = -Infinity;
  for (const [cur, cents] of Object.entries(revenueByCurrency)) {
    if (cents > best) {
      best = cents;
      currency = cur;
    }
  }
  if (best === -Infinity) {
    // No payments: fall back to the most common subscription currency.
    const subCur = subs[0]?.currency;
    if (subCur !== undefined && subCur !== "") currency = subCur;
  }

  const lifetimeRevenueCents = revenueByCurrency[currency] ?? 0;
  const windowRevenueCents = payments
    .filter((p) => p.currency === currency && p.createdAt >= windowStart)
    .reduce((s, p) => s + net(p), 0);

  // Revenue by month (last 12), primary currency, net.
  const monthBuckets = new Map<string, number>();
  for (const k of last12Months(now)) monthBuckets.set(k, 0);
  for (const p of payments) {
    if (p.currency !== currency) continue;
    const k = monthKey(p.createdAt);
    if (monthBuckets.has(k)) monthBuckets.set(k, (monthBuckets.get(k) ?? 0) + net(p));
  }
  const revenueByMonth: FinanceMonth[] = [...monthBuckets.entries()].map(
    ([month, revenueCents]) => ({
      month,
      revenueCents,
    }),
  );

  // Subscriptions → MRR, active count, top products (primary currency only).
  const activeSubs = subs.filter((s) => ACTIVE_STATUSES.has(s.status) && s.currency === currency);
  let mrrCents = 0;
  const productMrr = new Map<string, { mrrCents: number; activeCount: number }>();
  for (const s of activeSubs) {
    const m = toMonthlyCents(s.amount, s.interval);
    mrrCents += m;
    const name = s.productName ?? s.productId ?? "Assinatura";
    const cur = productMrr.get(name) ?? { mrrCents: 0, activeCount: 0 };
    cur.mrrCents += m;
    cur.activeCount += 1;
    productMrr.set(name, cur);
  }
  const topProducts: FinanceTopProduct[] = [...productMrr.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.mrrCents - a.mrrCents)
    .slice(0, 5);

  // Customers. First-seen = earliest payment or subscription creation per customer.
  const firstSeen = new Map<string, number>();
  const customersWithWindowPayment = new Set<string>();
  const paymentCountByCustomer = new Map<string, number>();
  for (const p of payments) {
    if (p.customerId === null) continue;
    firstSeen.set(p.customerId, Math.min(firstSeen.get(p.customerId) ?? Infinity, p.createdAt));
    if (p.createdAt >= windowStart) customersWithWindowPayment.add(p.customerId);
    paymentCountByCustomer.set(p.customerId, (paymentCountByCustomer.get(p.customerId) ?? 0) + 1);
  }
  const customersWithActiveSub = new Set<string>();
  for (const s of subs) {
    if (s.customerId === null) continue;
    firstSeen.set(s.customerId, Math.min(firstSeen.get(s.customerId) ?? Infinity, s.createdAt));
    if (ACTIVE_STATUSES.has(s.status)) customersWithActiveSub.add(s.customerId);
  }
  const activeCustomers = new Set<string>([
    ...customersWithActiveSub,
    ...customersWithWindowPayment,
  ]).size;
  let newCustomers = 0;
  for (const ts of firstSeen.values()) if (ts >= windowStart) newCustomers += 1;

  // Churn (needs subscriptions) or repeat-purchase fallback (one-time payments).
  let churnRatePct: number | null = null;
  let repeatPurchaseRatePct: number | null = null;
  if (subs.length > 0) {
    const activeAtStart = subs.filter(
      (s) => s.createdAt < windowStart && (s.canceledAt === null || s.canceledAt >= windowStart),
    ).length;
    const canceledInWindow = subs.filter(
      (s) => s.canceledAt !== null && s.canceledAt >= windowStart && s.canceledAt <= now,
    ).length;
    churnRatePct =
      activeAtStart > 0
        ? Math.round((canceledInWindow / activeAtStart) * 1000) / 10
        : canceledInWindow > 0
          ? 100
          : 0;
  } else {
    const payers = paymentCountByCustomer.size;
    const repeaters = [...paymentCountByCustomer.values()].filter((n) => n >= 2).length;
    repeatPurchaseRatePct = payers > 0 ? Math.round((repeaters / payers) * 1000) / 10 : null;
  }

  return {
    currency,
    lifetimeRevenueCents,
    windowRevenueCents,
    revenueByCurrency,
    mrrCents,
    activeSubscriptions: activeSubs.length,
    activeCustomers,
    newCustomers,
    churnRatePct,
    repeatPurchaseRatePct,
    topProducts,
    revenueByMonth,
    costCents,
    windowDays: Math.round(windowMs / 86_400_000),
    hasStripe: payments.length > 0 || subs.length > 0,
  };
};
