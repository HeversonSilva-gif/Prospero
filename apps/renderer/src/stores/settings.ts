import { create } from "zustand";
import type { AppSettings, AuthMode, ExecutorMode, Language, Theme } from "@dashboard-agent/shared";
import { DEFAULT_CLAUDE_MODEL } from "@dashboard-agent/shared";
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
  saveExecutorMode: (mode: ExecutorMode) => Promise<void>;
  setAuthMode: (mode: AuthMode) => Promise<void>;
  pickAndSetWorkspace: () => Promise<void>;
};

export const useSettingsStore = create<State>((set) => ({
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
  },
  loaded: false,

  load: async () => {
    const fresh = await window.dashboardAgent.settings.get();
    setLanguage(fresh.language);
    applyTheme(fresh.theme);
    set({ settings: fresh, loaded: true });
  },

  setLanguage: async (lang) => {
    const next = await window.dashboardAgent.settings.update({ language: lang });
    setLanguage(next.language);
    set({ settings: next });
  },

  setTheme: async (theme) => {
    const next = await window.dashboardAgent.settings.update({ theme });
    applyTheme(next.theme);
    set({ settings: next });
  },

  setWorkspaceCwd: async (path) => {
    const next = await window.dashboardAgent.settings.update({ workspaceCwd: path });
    set({ settings: next });
  },

  setModel: async (model) => {
    const next = await window.dashboardAgent.settings.update({ defaultModelForNewAgents: model });
    set({ settings: next });
  },

  pickAndSetWorkspace: async () => {
    const picked = await window.dashboardAgent.settings.pickWorkspace();
    if (picked === null) return;
    const next = await window.dashboardAgent.settings.update({ workspaceCwd: picked });
    set({ settings: next });
  },

  saveExecutorMode: async (mode) => {
    await window.dashboardAgent.settings.setExecutorMode(mode);
    set((s) => ({ settings: { ...s.settings, executorMode: mode } }));
  },

  setAuthMode: async (mode) => {
    const next = await window.dashboardAgent.settings.update({ authMode: mode });
    set({ settings: next });
  },
}));
