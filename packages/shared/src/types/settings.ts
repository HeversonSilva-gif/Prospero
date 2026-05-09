export type Language = "pt-BR" | "en-US";
export type Theme = "light" | "dark";

export type AppSettings = {
  language: Language;
  theme: Theme;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
};
