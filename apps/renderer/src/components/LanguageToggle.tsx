import { useSettingsStore } from "../stores/settings.js";
import { useTranslation } from "react-i18next";

export const LanguageToggle = () => {
  const { t } = useTranslation();
  const { settings, setLanguage } = useSettingsStore();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-muted">{t("settings.language")}</span>
      <div className="flex gap-0.5 rounded-md bg-surface-soft p-0.5 ml-auto">
        <button
          onClick={() => void setLanguage("pt-BR")}
          className={`px-2 py-1 text-xs font-semibold rounded ${
            settings.language === "pt-BR"
              ? "bg-brand text-brand-fg"
              : "text-ink-soft hover:text-ink"
          }`}
          type="button"
        >
          PT
        </button>
        <button
          onClick={() => void setLanguage("en-US")}
          className={`px-2 py-1 text-xs font-semibold rounded ${
            settings.language === "en-US"
              ? "bg-brand text-brand-fg"
              : "text-ink-soft hover:text-ink"
          }`}
          type="button"
        >
          EN
        </button>
      </div>
    </div>
  );
};
