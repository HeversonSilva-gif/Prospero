import { create } from "zustand";
import type {
  Goal,
  GoalWithPlan,
  GoalStatus,
  CreateGoalInput,
  ExecutePlanResult,
} from "@dashboard-agent/shared";

type State = {
  goals: Goal[];
  detail: GoalWithPlan | null;
  loaded: boolean;
  loading: boolean;
  load: (companyId: string, status?: GoalStatus) => Promise<void>;
  loadDetail: (id: string) => Promise<void>;
  clearDetail: () => void;
  create: (input: CreateGoalInput) => Promise<Goal>;
  requestPlan: (goalId: string) => Promise<void>;
  approvePlan: (
    planId: string,
    opts?: { includeAgentIndexes?: number[]; includeIssueIndexes?: number[] },
  ) => Promise<ExecutePlanResult>;
  requestChanges: (planId: string, feedback: string) => Promise<void>;
  rejectPlan: (planId: string, reason?: string) => Promise<void>;
  upsert: (goal: Goal) => void;
  remove: (id: string) => void;
};

export const useGoalsStore = create<State>((set, get) => ({
  goals: [],
  detail: null,
  loaded: false,
  loading: false,

  load: async (companyId, status) => {
    set({ loading: true });
    const args = status !== undefined ? { companyId, status } : { companyId };
    const goals = await window.dashboardAgent.goals.list(args);
    set({ goals, loaded: true, loading: false });
  },

  loadDetail: async (id) => {
    const detail = await window.dashboardAgent.goals.get({ id });
    set({ detail });
  },

  clearDetail: () => set({ detail: null }),

  create: async (input) => {
    const goal = await window.dashboardAgent.goals.create(input);
    set((s) => ({ goals: [goal, ...s.goals] }));
    return goal;
  },

  requestPlan: async (goalId) => {
    await window.dashboardAgent.goals.requestPlan({ goalId });
    if (get().detail?.id === goalId) {
      await get().loadDetail(goalId);
    }
  },

  approvePlan: async (planId, opts) => {
    const args: {
      planId: string;
      includeAgentIndexes?: number[];
      includeIssueIndexes?: number[];
    } = { planId };
    if (opts?.includeAgentIndexes !== undefined)
      args.includeAgentIndexes = opts.includeAgentIndexes;
    if (opts?.includeIssueIndexes !== undefined)
      args.includeIssueIndexes = opts.includeIssueIndexes;
    const result = await window.dashboardAgent.goals.approvePlan(args);
    const detail = get().detail;
    if (result.ok && detail?.currentPlan?.id === planId) {
      await get().loadDetail(detail.id);
    }
    return result;
  },

  requestChanges: async (planId, feedback) => {
    await window.dashboardAgent.goals.requestChanges({ planId, feedback });
    const detail = get().detail;
    if (detail?.currentPlan?.id === planId) {
      await get().loadDetail(detail.id);
    }
  },

  rejectPlan: async (planId, reason) => {
    const args: { planId: string; reason?: string } = { planId };
    if (reason !== undefined) args.reason = reason;
    await window.dashboardAgent.goals.rejectPlan(args);
    const detail = get().detail;
    if (detail?.currentPlan?.id === planId) {
      await get().loadDetail(detail.id);
    }
  },

  upsert: (goal) =>
    set((s) =>
      s.goals.some((g) => g.id === goal.id)
        ? { goals: s.goals.map((g) => (g.id === goal.id ? goal : g)) }
        : { goals: [goal, ...s.goals] },
    ),

  remove: (id) =>
    set((s) => ({
      goals: s.goals.filter((g) => g.id !== id),
      detail: s.detail?.id === id ? null : s.detail,
    })),
}));
