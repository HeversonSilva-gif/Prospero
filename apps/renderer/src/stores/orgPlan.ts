import { create } from "zustand";
import type { ApplyOrgPlanResult, OrgPlan } from "@prospero/shared";

type ApproveOpts = {
  includeRoleIndexes?: number[];
  includeAgentIndexes?: number[];
};

type State = {
  plan: OrgPlan | null;
  loaded: boolean;
  load: () => Promise<void>;
  approve: (opts?: ApproveOpts) => Promise<ApplyOrgPlanResult>;
  reject: (reason?: string) => Promise<void>;
};

export const useOrgPlanStore = create<State>((set, get) => ({
  plan: null,
  loaded: false,

  load: async () => {
    const plan = await window.prospero.orgPlan.getCurrent();
    set({ plan, loaded: true });
  },

  approve: async (opts) => {
    const plan = get().plan;
    if (plan === null) throw new Error("no org plan loaded");
    const result = await window.prospero.orgPlan.approve({
      orgPlanId: plan.id,
      ...(opts?.includeRoleIndexes !== undefined
        ? { includeRoleIndexes: opts.includeRoleIndexes }
        : {}),
      ...(opts?.includeAgentIndexes !== undefined
        ? { includeAgentIndexes: opts.includeAgentIndexes }
        : {}),
    });
    if (result.ok) set({ plan: null });
    return result;
  },

  reject: async (reason) => {
    const plan = get().plan;
    if (plan === null) throw new Error("no org plan loaded");
    await window.prospero.orgPlan.reject({
      orgPlanId: plan.id,
      ...(reason !== undefined ? { reason } : {}),
    });
    set({ plan: null });
  },
}));
