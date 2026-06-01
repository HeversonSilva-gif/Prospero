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
    currency: string;
    createdAt: number;
    recordedAt: number;
  }) => boolean;
  onFirstSale: (companyId: string, charge: { amount: number; currency: string }) => void;
  windowMs: number;
  now: () => number;
};

export const collectStripeSales = async (deps: CollectStripeSalesDeps): Promise<void> => {
  for (const companyId of deps.listCompaniesWithStripe()) {
    try {
      const key = deps.getKey(companyId);
      if (key === null) continue;
      const hadBefore = deps.countExisting(companyId) > 0;
      const charges = await deps.listCharges(key, deps.now() - deps.windowMs);
      let firstNew: { amount: number; currency: string } | null = null;
      for (const c of charges) {
        if (c.status !== "succeeded") continue;
        const isNew = deps.record({
          id: c.id,
          companyId,
          amount: c.amount,
          currency: c.currency,
          createdAt: c.created,
          recordedAt: deps.now(),
        });
        if (isNew && firstNew === null) firstNew = { amount: c.amount, currency: c.currency };
      }
      if (!hadBefore && firstNew !== null) deps.onFirstSale(companyId, firstNew);
    } catch (err) {
      console.warn(`[stripe-sales] collection failed for company ${companyId}`, err);
    }
  }
};
