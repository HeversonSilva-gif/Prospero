import type { StripeCharge } from "./stripe-client.js";

// Pure per-company sales ingestion. All I/O injected so it is unit-testable without
// electron / a live Stripe account. Fail-soft: a company that errors is logged and
// skipped; the rest still run. Detects the FIRST sale exactly once (a company that
// had no payments before this run and records at least one succeeded charge).
export type CollectStripeSalesDeps = {
  listCompaniesWithStripe: () => string[];
  getKey: (companyId: string) => string | null;
  listCharges: (key: string, sinceMs: number) => Promise<StripeCharge[]>;
  countExisting: (companyId: string) => number;
  record: (input: {
    id: string;
    companyId: string;
    amount: number;
    amountRefunded: number;
    currency: string;
    createdAt: number;
    recordedAt: number;
    customerId: string | null;
  }) => boolean;
  onFirstSale: (companyId: string, charge: { amount: number; currency: string }) => void;
  windowMs: number;
  now: () => number;
  // M3 backfill cursor: the newest charge time we already stored. When it predates the
  // window (the app was closed longer than windowMs), we fetch from there so charges in
  // the gap aren't lost. Optional — absent ⇒ the plain window.
  lastCreatedAt?: (companyId: string) => number | null;
};

export const collectStripeSales = async (deps: CollectStripeSalesDeps): Promise<void> => {
  for (const companyId of deps.listCompaniesWithStripe()) {
    try {
      const key = deps.getKey(companyId);
      if (key === null) continue;
      const hadBefore = deps.countExisting(companyId) > 0;
      const windowStart = deps.now() - deps.windowMs;
      const cursor = deps.lastCreatedAt?.(companyId) ?? null;
      // Fetch from the older of (window start, last stored charge): the window is the
      // refund-refresh safety net; the cursor backfills a gap from a long closure (M3).
      const since = cursor !== null && cursor < windowStart ? cursor : windowStart;
      const charges = await deps.listCharges(key, since);
      let firstNew: { amount: number; currency: string; created: number } | null = null;
      for (const c of charges) {
        if (c.status !== "succeeded") continue;
        const isNew = deps.record({
          id: c.id,
          companyId,
          amount: c.amount,
          amountRefunded: c.amountRefunded,
          currency: c.currency,
          createdAt: c.created,
          recordedAt: deps.now(),
          customerId: c.customer,
        });
        // The first sale is the EARLIEST new charge (Stripe lists newest-first) — M3.
        if (isNew && (firstNew === null || c.created < firstNew.created)) {
          firstNew = { amount: c.amount, currency: c.currency, created: c.created };
        }
      }
      if (!hadBefore && firstNew !== null) {
        deps.onFirstSale(companyId, { amount: firstNew.amount, currency: firstNew.currency });
      }
    } catch (err) {
      console.warn(`[stripe-sales] collection failed for company ${companyId}`, err);
    }
  }
};
