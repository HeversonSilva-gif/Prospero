import type { AccountSnapshot } from "./x-metrics-repository.js";

// Pure stagnation heuristic over the follower series (oldest → newest). Needs at
// least 2 data points; with fewer, it never flags (no data ≠ stagnation). Stagnant
// when net follower gain over the window is at or below `minGrowth`.
export const assessGrowth = (
  series: AccountSnapshot[],
  opts?: { minGrowth?: number },
): { stagnant: boolean; summary: string } => {
  if (series.length < 2) return { stagnant: false, summary: "Sem dados suficientes." };
  const delta = series[series.length - 1]!.followers - series[0]!.followers;
  const minGrowth = opts?.minGrowth ?? 1;
  const sign = delta >= 0 ? `+${delta}` : `${delta}`;
  return delta <= minGrowth
    ? { stagnant: true, summary: `crescimento estagnado (${sign} seguidores na janela)` }
    : { stagnant: false, summary: `crescendo (${sign} seguidores na janela)` };
};

export type ReviewXGrowthDeps = {
  listCompaniesWithX: () => string[];
  accountSeries: (companyId: string, sinceMs: number) => AccountSnapshot[];
  windowMs: number;
  now: () => number;
  // De-dup: returns false when this company was nudged too recently.
  shouldNudge: (companyId: string) => boolean;
  // Side effect (nudge the CEO + record the nudge). Wired in MAIN.
  onStagnant: (companyId: string, summary: string) => void;
};

// Per-company growth review. Fail-soft: a company that errors is logged + skipped.
export const reviewXGrowth = (deps: ReviewXGrowthDeps): void => {
  for (const companyId of deps.listCompaniesWithX()) {
    try {
      if (!deps.shouldNudge(companyId)) continue;
      const a = assessGrowth(deps.accountSeries(companyId, deps.now() - deps.windowMs));
      if (a.stagnant) deps.onStagnant(companyId, a.summary);
    } catch (err) {
      console.warn(`[x-growth] review failed for company ${companyId}`, err);
    }
  }
};
