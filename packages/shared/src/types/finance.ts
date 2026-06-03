// Finance panorama wire types (v0.2.8 Financeiro screen). Shared so MAIN's
// computeFinanceSummary, the IPC bridge and the renderer agree on one shape.

export type FinanceTopProduct = { name: string; mrrCents: number; activeCount: number };
export type FinanceMonth = { month: string; revenueCents: number }; // month = "YYYY-MM"

export type FinanceSummary = {
  currency: string; // primary currency (lowercase), e.g. "brl"
  lifetimeRevenueCents: number; // net, primary currency, all-time
  windowRevenueCents: number; // net, primary currency, within the window
  revenueByCurrency: Record<string, number>; // net lifetime, every currency
  mrrCents: number; // monthly-normalized active recurring revenue, primary currency
  activeSubscriptions: number;
  activeCustomers: number; // distinct customers with an active sub OR a payment in window
  newCustomers: number; // distinct customers first seen within the window
  churnRatePct: number | null; // canceled-in-window / active-at-window-start; null if no subs
  repeatPurchaseRatePct: number | null; // fallback when there are no subscriptions
  topProducts: FinanceTopProduct[]; // active subs grouped by product, top 5 by MRR
  revenueByMonth: FinanceMonth[]; // last 12 months incl. current, net, primary currency
  costCents: number; // Claude cost (USD cents) in the window — for cost vs revenue
  windowDays: number;
  hasStripe: boolean; // whether any payment or subscription exists at all
};
