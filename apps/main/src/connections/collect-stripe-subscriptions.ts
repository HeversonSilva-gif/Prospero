import type { StripeSubscription } from "./stripe-client.js";
import type { StripeSubscriptionRow } from "./stripe-subscriptions-repository.js";

// Pure per-company subscription ingestion. All I/O injected so it is unit-testable
// without electron / a live Stripe account. Fail-soft: a company that errors is logged
// and skipped; the rest still run. Feeds the finance panorama's MRR / churn / customers.
export type CollectStripeSubscriptionsDeps = {
  listCompaniesWithStripe: () => string[];
  getKey: (companyId: string) => string | null;
  listSubscriptions: (key: string) => Promise<StripeSubscription[]>;
  record: (input: StripeSubscriptionRow & { recordedAt: number }) => void;
  now: () => number;
};

export const collectStripeSubscriptions = async (
  deps: CollectStripeSubscriptionsDeps,
): Promise<void> => {
  let companies: string[] = [];
  try {
    companies = deps.listCompaniesWithStripe();
  } catch (err) {
    console.warn("[stripe-subs] listing companies failed", err);
    return;
  }
  for (const companyId of companies) {
    try {
      const key = deps.getKey(companyId);
      if (key === null) continue;
      const subs = await deps.listSubscriptions(key);
      const recordedAt = deps.now();
      for (const s of subs) {
        deps.record({
          id: s.id,
          companyId,
          customerId: s.customer,
          status: s.status,
          productId: s.productId,
          productName: s.productName,
          amount: s.amount,
          currency: s.currency,
          interval: s.interval,
          createdAt: s.created,
          canceledAt: s.canceledAt,
          recordedAt,
        });
      }
    } catch (err) {
      console.warn(`[stripe-subs] collection failed for company ${companyId}`, err);
    }
  }
};
