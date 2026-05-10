export type Language = "pt-BR" | "en-US";
export type Theme = "light" | "dark";

export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
};
