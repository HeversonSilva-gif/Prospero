import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@prospero/shared";
import ptBR from "./pt-BR.json";
import enUS from "./en-US.json";

void i18n.use(initReactI18next).init({
  resources: {
    "pt-BR": { translation: ptBR },
    "en-US": { translation: enUS },
  },
  lng: "pt-BR",
  fallbackLng: "pt-BR",
  interpolation: { escapeValue: false },
});

export const setLanguage = (lang: Language): void => {
  void i18n.changeLanguage(lang);
};

export default i18n;
