import { create } from "zustand";
import type { BusinessPlan } from "@prospero/shared";

type State = {
  plan: BusinessPlan | null;
  loaded: boolean;
  // Renderer-local selection for the 3-options flow. null = still on the chooser;
  // a number = user picked that index → show the plan review. Reset on load().
  chosenIndex: number | null;
  load: () => Promise<void>;
  chooseOption: (index: number) => void;
  backToOptions: () => void;
  approve: () => Promise<{ ok: boolean; error?: string }>;
  reject: (reason?: string) => Promise<void>;
};

export const useBusinessPlanStore = create<State>((set, get) => ({
  plan: null,
  loaded: false,
  chosenIndex: null,
  load: async () => {
    const plan = await window.prospero.businessPlan.getCurrent();
    set({ plan, loaded: true, chosenIndex: null });
  },
  chooseOption: (index: number) => {
    set({ chosenIndex: index });
  },
  backToOptions: () => {
    set({ chosenIndex: null });
  },
  approve: async () => {
    const plan = get().plan;
    if (plan === null) throw new Error("no business plan loaded");
    const result = await window.prospero.businessPlan.approve(plan.id, get().chosenIndex);
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
