import { create } from "zustand";
import type { BusinessPlan } from "@prospero/shared";

type State = {
  plan: BusinessPlan | null;
  loaded: boolean;
  load: () => Promise<void>;
  approve: () => Promise<{ ok: boolean; error?: string }>;
  reject: (reason?: string) => Promise<void>;
};

export const useBusinessPlanStore = create<State>((set, get) => ({
  plan: null,
  loaded: false,
  load: async () => {
    const plan = await window.prospero.businessPlan.getCurrent();
    set({ plan, loaded: true });
  },
  approve: async () => {
    const plan = get().plan;
    if (plan === null) throw new Error("no business plan loaded");
    const result = await window.prospero.businessPlan.approve(plan.id);
    if (result.ok) set({ plan: null });
    return result;
  },
  reject: async (reason) => {
    const plan = get().plan;
    if (plan === null) throw new Error("no business plan loaded");
    await window.prospero.businessPlan.reject(plan.id, reason);
    set({ plan: null });
  },
}));
