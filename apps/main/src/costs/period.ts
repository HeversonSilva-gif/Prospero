// Period math for per-agent budgets (M12 PR-E2). Daily and monthly windows
// are UTC. periodKey is the dedup key for the 80% budget Inbox warning.

import type { BudgetPeriod } from "@prospero/shared";

export const utcMonthBounds = (now: Date): { start: number; end: number } => {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = Date.UTC(y, m, 1);
  const end = m === 11 ? Date.UTC(y + 1, 0, 1) : Date.UTC(y, m + 1, 1);
  return { start, end };
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

export const periodKey = (period: BudgetPeriod, now: Date): string => {
  const y = String(now.getUTCFullYear());
  const m = pad2(now.getUTCMonth() + 1);
  if (period === "monthly") return `${y}-${m}`;
  return `${y}-${m}-${pad2(now.getUTCDate())}`;
};
