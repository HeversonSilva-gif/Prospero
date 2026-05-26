import { create } from "zustand";
import type { ApiKeyStatus, RecoveryResult, TokenSource, TokenStatus } from "@prospero/shared";

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
  reconnectRunningAgents: () => Promise<RecoveryResult[]>;
};

export const useAuthStore = create<State>((set) => ({
  status: { hasToken: false },
  apiKeyStatus: { hasKey: false },
  loaded: false,

  load: async () => {
    const [status, apiKeyStatus] = await Promise.all([
      window.prospero.auth.status(),
      window.prospero.auth.apiKeyStatus(),
    ]);
    set({ status, apiKeyStatus, loaded: true });
  },

  setToken: async (raw, source) => {
    const status = await window.prospero.auth.set(raw, source);
    set({ status });
  },

  importDetected: async () => {
    const status = await window.prospero.auth.importDetected();
    set({ status });
  },

  clearToken: async () => {
    const status = await window.prospero.auth.clear();
    set({ status });
  },

  setApiKey: async (raw) => {
    const apiKeyStatus = await window.prospero.auth.apiKeySet(raw);
    set({ apiKeyStatus });
  },

  clearApiKey: async () => {
    const apiKeyStatus = await window.prospero.auth.apiKeyClear();
    set({ apiKeyStatus });
  },

  reconnectRunningAgents: async () => {
    return window.prospero.auth.reconnectRunningAgents();
  },
}));
