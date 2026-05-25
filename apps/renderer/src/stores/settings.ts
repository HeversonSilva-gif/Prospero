import { create } from "zustand";
import type {
  AppSettings,
  AuthMode,
  ExecutorMode,
  Language,
  RemoteExecutionSettings,
  Theme,
} from "@prospero/shared";
import { DEFAULT_CLAUDE_MODEL } from "@prospero/shared";
import { setLanguage } from "../i18n/index.js";
import { applyTheme } from "../theme/ThemeProvider.js";

type State = {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setWorkspaceCwd: (path: string | null) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setDerivationsPerDay: (n: number) => Promise<void>;
  saveExecutorMode: (mode: ExecutorMode) => Promise<void>;
  setAuthMode: (mode: AuthMode) => Promise<void>;
  setRemoteExecution: (patch: Partial<RemoteExecutionSettings>) => Promise<void>;
  pickAndSetWorkspace: () => Promise<void>;
};

export const useSettingsStore = create<State>((set, get) => ({
  settings: {
    language: "pt-BR",
    theme: "light",
    workspaceCwd: null,
    defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
    executorMode: "atomic",
    activeCompanyId: null,
    authMode: "oauth",
    defaultAgentMode: "supervised",
    defaultAlwaysOn: false,
    derivationsPerDayPerAgent: 3,
    compactionCacheReadThreshold: 300_000,
    rateLimitedUntil: null,
    remoteExecution: {
      enabled: false,
      mode: "local-docker",
      vpsHost: "",
      vpsUser: "",
      vpsKeyPath: "",
    },
  },
  loaded: false,

  load: async () => {
    const fresh = await window.prospero.settings.get();
    setLanguage(fresh.language);
    applyTheme(fresh.theme);
    set({ settings: fresh, loaded: true });
  },

  setLanguage: async (lang) => {
    const next = await window.prospero.settings.update({ language: lang });
    setLanguage(next.language);
    set({ settings: next });
  },

  setTheme: async (theme) => {
    const next = await window.prospero.settings.update({ theme });
    applyTheme(next.theme);
    set({ settings: next });
  },

  setWorkspaceCwd: async (path) => {
    const next = await window.prospero.settings.update({ workspaceCwd: path });
    set({ settings: next });
  },

  setModel: async (model) => {
    const next = await window.prospero.settings.update({ defaultModelForNewAgents: model });
    set({ settings: next });
  },

  setDerivationsPerDay: async (n) => {
    const next = await window.prospero.settings.update({ derivationsPerDayPerAgent: n });
    set({ settings: next });
  },

  pickAndSetWorkspace: async () => {
    const picked = await window.prospero.settings.pickWorkspace();
    if (picked === null) return;
    const next = await window.prospero.settings.update({ workspaceCwd: picked });
    set({ settings: next });
  },

  saveExecutorMode: async (mode) => {
    await window.prospero.settings.setExecutorMode(mode);
    set((s) => ({ settings: { ...s.settings, executorMode: mode } }));
  },

  setAuthMode: async (mode) => {
    const next = await window.prospero.settings.update({ authMode: mode });
    set({ settings: next });
  },

  setRemoteExecution: async (patch) => {
    const merged = { ...get().settings.remoteExecution, ...patch };
    const next = await window.prospero.settings.update({ remoteExecution: merged });
    set({ settings: next });
  },
}));
