import type { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

// M16 PR-C2 — barra fina acima do AgentHeader na Página do funcionário.
// Mostra back link + ação ("Ajustar" no modo conversa; "Conversa" no modo ajustar).

type Mode = "conversa" | "ajustar";

type Props = {
  agentId: string;
  agentName: string;
  mode: Mode;
};

export const BreadcrumbBar: FC<Props> = ({ agentId, agentName, mode }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surface-soft border-b border-surface-border text-xs">
      <div className="flex items-center gap-2 text-ink-muted">
        <Link to="/agents" className="hover:text-ink">
          ← {t("nav.equipe")}
        </Link>
        <span>/</span>
        {mode === "conversa" ? (
          <span className="text-ink font-semibold">{agentName}</span>
        ) : (
          <>
            <Link to={`/agents/${agentId}`} className="hover:text-ink">
              {agentName}
            </Link>
            <span>/</span>
            <span className="text-ink font-semibold">{t("funcionario.ajustar")}</span>
          </>
        )}
      </div>
      {mode === "conversa" ? (
        <Link
          to={`/agents/${agentId}/ajustar`}
          className="text-xs font-semibold px-3 py-1 rounded bg-surface-card border border-surface-border text-ink hover:border-brand hover:text-brand"
        >
          {t("funcionario.ajustar")}
        </Link>
      ) : (
        <Link
          to={`/agents/${agentId}`}
          className="text-xs font-semibold px-3 py-1 rounded bg-surface-card border border-surface-border text-ink hover:border-brand hover:text-brand"
        >
          ← {t("funcionario.voltarConversa")}
        </Link>
      )}
    </div>
  );
};
