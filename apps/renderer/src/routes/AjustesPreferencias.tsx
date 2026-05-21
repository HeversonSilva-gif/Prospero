import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { LanguageToggle } from "../components/LanguageToggle.js";
import { AjustesPageHeader } from "../components/ajustes/AjustesPageHeader.js";

// M16 PR-B2 — sub-página /settings/preferencias.
// Wrappa ThemeToggle + LanguageToggle (componentes existentes,
// continuam disponíveis no SidebarFooter também).

export const AjustesPreferencias: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="p-8 max-w-2xl">
      <AjustesPageHeader title={t("ajustes.preferencias.title")} />
      <h1 className="text-2xl font-bold text-ink mb-6">{t("ajustes.preferencias.title")}</h1>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-3">{t("settings.theme")}</h2>
        <ThemeToggle />
      </section>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-3">{t("settings.language")}</h2>
        <LanguageToggle />
      </section>
    </div>
  );
};
