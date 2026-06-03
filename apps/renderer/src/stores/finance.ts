import { create } from "zustand";
import type { FinanceSummary } from "@prospero/shared";

type FinanceState = {
  summary: FinanceSummary | null;
  days: number;
  loading: boolean;
  error: string | null;
  load: (companyId: string, days?: number) => Promise<void>;
};

// Read-only store for the Financeiro panorama. Mirrors the briefing store pattern.
export const useFinanceStore = create<FinanceState>((set, get) => ({
  summary: null,
  days: 30,
  loading: false,
  error: null,
  async load(companyId, days) {
    const windowDays = days ?? get().days;
    set({ loading: true, error: null, days: windowDays });
    try {
      const summary = await window.prospero.finance.summary(companyId, windowDays);
      set({ summary, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
