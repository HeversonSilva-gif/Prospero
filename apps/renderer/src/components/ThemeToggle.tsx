import { useSettingsStore } from "../stores/settings.js";
import { useTranslation } from "react-i18next";

export const ThemeToggle = () => {
  const { t } = useTranslation();
  const { settings, setTheme } = useSettingsStore();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-muted">{t("settings.theme")}</span>
      <div className="flex gap-0.5 rounded-md bg-surface-soft p-0.5 ml-auto">
        <button
          onClick={() => void setTheme("light")}
          className={`px-2 py-1 text-xs font-semibold rounded ${
            settings.theme === "light" ? "bg-brand text-brand-fg" : "text-ink-soft hover:text-ink"
          }`}
          aria-label={t("settings.theme.light")}
          type="button"
        >
          ☀
        </button>
        <button
          onClick={() => void setTheme("dark")}
          className={`px-2 py-1 text-xs font-semibold rounded ${
            settings.theme === "dark" ? "bg-brand text-brand-fg" : "text-ink-soft hover:text-ink"
          }`}
          aria-label={t("settings.theme.dark")}
          type="button"
        >
          ☾
        </button>
      </div>
    </div>
  );
};
