import { create } from "zustand";
import type { AppSettings, Language, Theme } from "@dashboard-agent/shared";
import { setLanguage } from "../i18n/index.js";
import { applyTheme } from "../theme/ThemeProvider.js";

type State = {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
};

export const useSettingsStore = create<State>((set) => ({
  settings: { language: "pt-BR", theme: "light" },
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
}));
