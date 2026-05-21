import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { IssuesTab } from "./IssuesTab.js";
import { StatsTab } from "./StatsTab.js";
import { RunsTab } from "./RunsTab.js";

// M16 PR-C3 — Histórico tab. Stacks IssuesTab (tarefas) + StatsTab (métricas)
// + RunsTab (execuções) em sections empilhadas com section headers pequenos.

type Props = {
  agentId: string;
  companyId: string;
};

const SectionHeader: FC<{ label: string }> = ({ label }) => (
  <h3 className="px-6 pt-6 pb-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">
    {label}
  </h3>
);

export const HistoricoTab: FC<Props> = ({ agentId, companyId }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <SectionHeader label={t("ajustar.historico.tarefas")} />
      <IssuesTab agentId={agentId} companyId={companyId} />
      <SectionHeader label={t("ajustar.historico.metricas")} />
      <StatsTab agentId={agentId} />
      <SectionHeader label={t("ajustar.historico.execucoes")} />
      <RunsTab agentId={agentId} companyId={companyId} />
    </div>
  );
};
