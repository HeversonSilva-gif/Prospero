import { create } from "zustand";
import type { TokenSource, TokenStatus } from "@dashboard-agent/shared";

type State = {
  status: TokenStatus;
  loaded: boolean;
  load: () => Promise<void>;
  setToken: (raw: string, source: TokenSource) => Promise<void>;
  clearToken: () => Promise<void>;
};

export const useAuthStore = create<State>((set) => ({
  status: { hasToken: false },
  loaded: false,

  load: async () => {
    const status = await window.dashboardAgent.auth.status();
    set({ status, loaded: true });
  },

  setToken: async (raw, source) => {
    const status = await window.dashboardAgent.auth.set(raw, source);
    set({ status });
  },

  clearToken: async () => {
    const status = await window.dashboardAgent.auth.clear();
    set({ status });
  },
}));
