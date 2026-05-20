import type { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

// M16 PR-B2 — header padrão das sub-páginas de Ajustes.
// Breadcrumb "← Ajustes / Conta" no topo. Mesmo padrão do RoutineForm M15 PR-B.

type Props = {
  title: string;
};

export const AjustesPageHeader: FC<Props> = ({ title }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted mb-4">
      <Link to="/settings" className="hover:text-ink">
        ← {t("ajustes.backToAjustes")}
      </Link>
      <span>/</span>
      <span className="text-ink font-semibold">{title}</span>
    </div>
  );
};
