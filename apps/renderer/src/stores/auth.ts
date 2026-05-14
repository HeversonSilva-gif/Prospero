import { create } from "zustand";
import type { ApiKeyStatus, TokenSource, TokenStatus } from "@dashboard-agent/shared";

type State = {
  status: TokenStatus;
  apiKeyStatus: ApiKeyStatus;
  loaded: boolean;
  load: () => Promise<void>;
  setToken: (raw: string, source: TokenSource) => Promise<void>;
  importDetected: () => Promise<void>;
  clearToken: () => Promise<void>;
  setApiKey: (raw: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
};

export const useAuthStore = create<State>((set) => ({
  status: { hasToken: false },
  apiKeyStatus: { hasKey: false },
  loaded: false,

  load: async () => {
    const [status, apiKeyStatus] = await Promise.all([
      window.dashboardAgent.auth.status(),
      window.dashboardAgent.auth.apiKeyStatus(),
    ]);
    set({ status, apiKeyStatus, loaded: true });
  },

  setToken: async (raw, source) => {
    const status = await window.dashboardAgent.auth.set(raw, source);
    set({ status });
  },

  importDetected: async () => {
    const status = await window.dashboardAgent.auth.importDetected();
    set({ status });
  },

  clearToken: async () => {
    const status = await window.dashboardAgent.auth.clear();
    set({ status });
  },

  setApiKey: async (raw) => {
    const apiKeyStatus = await window.dashboardAgent.auth.apiKeySet(raw);
    set({ apiKeyStatus });
  },

  clearApiKey: async () => {
    const apiKeyStatus = await window.dashboardAgent.auth.apiKeyClear();
    set({ apiKeyStatus });
  },
}));
