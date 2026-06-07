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
  setAutonomyPaused: (paused: boolean) => Promise<void>;
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
    compactionCacheReadThreshold: 75_000,
    rateLimitedUntil: null,
    autonomyPaused: true,
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
    // Routes through the dedicated AUTH_SET_MODE handler (not the generic settings
    // update) so the main process also migrates existing agents to the matching
    // adapter and respawns the live ones — no need to re-hire the team.
    const next = await window.prospero.settings.setAuthMode(mode);
    set({ settings: next });
  },

  setAutonomyPaused: async (paused) => {
    // Global play/pause for the autonomous loop. Unpausing (false) makes the main
    // process kick the scheduler so the team starts working right away.
    const next = await window.prospero.settings.setAutonomyPaused(paused);
    set({ settings: next });
  },

  setRemoteExecution: async (patch) => {
    const merged = { ...get().settings.remoteExecution, ...patch };
    const next = await window.prospero.settings.update({ remoteExecution: merged });
    set({ settings: next });
  },
}));
