// Crosses Claude cost (cost_events, cents) with Stripe revenue. Pure `assessFinance` +
// fail-soft `reviewFinance`, mirroring x-growth-review. FX-free: "at a loss" means cost has
// accrued (≥ threshold) and there is NO revenue in the window — we never convert USD↔BRL.

export const assessFinance = (input: {
  costCents: number;
  revenueCents: number;
  thresholdCents: number;
}): { atLoss: boolean } => ({
  atLoss: input.costCents >= input.thresholdCents && input.revenueCents === 0,
});

const summarize = (costCents: number, byCurrency: Record<string, number>, days: number): string => {
  const cost = `US$${(costCents / 100).toFixed(2)}`;
  const entries = Object.entries(byCurrency).filter(([, v]) => v > 0);
  const earned =
    entries.length === 0
      ? "nada"
      : entries
          .map(([cur, cents]) => `${cur.toUpperCase()} ${(cents / 100).toFixed(2)}`)
          .join(" + ");
  return `gastou ${cost} em IA nos últimos ${String(days)} dias e faturou ${earned}`;
};

export type ReviewFinanceDeps = {
  listCompanies: () => string[];
  windowCostCents: (companyId: string, sinceMs: number) => number;
  windowRevenue: (
    companyId: string,
    sinceMs: number,
  ) => { totalCents: number; byCurrency: Record<string, number> };
  windowMs: number;
  thresholdCents: number;
  now: () => number;
  shouldNudge: (companyId: string) => boolean;
  onLoss: (companyId: string, summary: string) => void;
};

export const reviewFinance = (deps: ReviewFinanceDeps): void => {
  for (const companyId of deps.listCompanies()) {
    try {
      if (!deps.shouldNudge(companyId)) continue;
      const since = deps.now() - deps.windowMs;
      const costCents = deps.windowCostCents(companyId, since);
      const revenue = deps.windowRevenue(companyId, since);
      const { atLoss } = assessFinance({
        costCents,
        revenueCents: revenue.totalCents,
        thresholdCents: deps.thresholdCents,
      });
      if (atLoss) {
        deps.onLoss(
          companyId,
          summarize(costCents, revenue.byCurrency, Math.round(deps.windowMs / 86_400_000)),
        );
      }
    } catch (err) {
      console.warn(`[finance] review failed for company ${companyId}`, err);
    }
  }
};
