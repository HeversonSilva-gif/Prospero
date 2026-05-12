import { create } from "zustand";
import type { CostBudgets } from "@dashboard-agent/shared";

const DEFAULTS: CostBudgets = {
  maxTokensPerDayPerAgent: 2_000_000,
  maxTokensPerIssue: 200_000,
  rateLimitWindowTokens: 1_000_000,
  rateLimitWindowHours: 5,
};

type State = {
  budgets: CostBudgets;
  loaded: boolean;
  load: () => Promise<void>;
  save: (patch: Partial<CostBudgets>) => Promise<void>;
};

export const useBudgetsStore = create<State>((set) => ({
  budgets: DEFAULTS,
  loaded: false,
  load: async () => {
    const b = await window.dashboardAgent.costs.getBudgets();
    set({ budgets: b, loaded: true });
  },
  save: async (patch) => {
    const next = await window.dashboardAgent.costs.setBudgets(patch);
    set({ budgets: next });
  },
}));
