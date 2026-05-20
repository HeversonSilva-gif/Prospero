import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { AjustesCard } from "../components/ajustes/AjustesCard.js";
import {
  UserIcon,
  CreditCardIcon,
  SlidersIcon,
  WrenchIcon,
} from "../components/ajustes/ajustes-icons.js";

// M16 PR-B2 — entrada de Ajustes. Grade de 4 cartões.
// Gastos navega pra /costs (existente); os outros 3 vão pras sub-páginas novas.

export const Ajustes: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-ink mb-6">{t("ajustes.title")}</h1>
      <div className="grid grid-cols-2 gap-4">
        <AjustesCard
          to="/settings/conta"
          icon={<UserIcon />}
          title={t("ajustes.conta.title")}
          sub={t("ajustes.conta.sub")}
        />
        <AjustesCard
          to="/costs"
          icon={<CreditCardIcon />}
          title={t("ajustes.gastos.title")}
          sub={t("ajustes.gastos.sub")}
        />
        <AjustesCard
          to="/settings/preferencias"
          icon={<SlidersIcon />}
          title={t("ajustes.preferencias.title")}
          sub={t("ajustes.preferencias.sub")}
        />
        <AjustesCard
          to="/settings/avancado"
          icon={<WrenchIcon />}
          title={t("ajustes.avancado.title")}
          sub={t("ajustes.avancado.sub")}
        />
      </div>
    </div>
  );
};
