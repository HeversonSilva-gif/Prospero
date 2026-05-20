import { create } from "zustand";
import type { Briefing } from "@prospero/shared";

interface BriefingState {
  briefing: Briefing | null;
  loading: boolean;
  error: string | null;
  load: (companyId: string) => Promise<void>;
  markReviewed: (companyId: string) => Promise<void>;
}

export const useBriefingStore = create<BriefingState>((set) => ({
  briefing: null,
  loading: false,
  error: null,
  async load(companyId) {
    set({ loading: true, error: null });
    try {
      const b = await window.prospero.briefing.get({ companyId });
      set({ briefing: b, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  async markReviewed(companyId) {
    await window.prospero.briefing.markReviewed({ companyId });
    // Re-load so the buckets reflect the new cursor.
    set({ loading: true });
    try {
      const b = await window.prospero.briefing.get({ companyId });
      set({ briefing: b, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
