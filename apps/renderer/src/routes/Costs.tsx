// /costs route — wires header + filters + charts + table to PR-A IPCs.
// This whole file is in the lazy chunk loaded by React.lazy in App.tsx.

import { useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useAgentsStore } from "../stores/agents.js";
import { AjustesPageHeader } from "../components/ajustes/AjustesPageHeader.js";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";
import { useProjectsStore } from "../stores/projects.js";
import { useCostsQuery, type CostsQueryFilters } from "../hooks/useCostsQuery.js";
import { useCostsToday } from "../hooks/useCostsToday.js";
import { useCostsStream } from "../hooks/useCostsStream.js";
import { fillMissingDays } from "../lib/costs/bucketByDay.js";
import { CostsHeader } from "../components/costs/CostsHeader.js";
import { CostsFilters } from "../components/costs/CostsFilters.js";
import { CostsChartTimeSeries } from "../components/costs/CostsChartTimeSeries.js";
import { CostsChartByAgent } from "../components/costs/CostsChartByAgent.js";
import { CostsChartByProject } from "../components/costs/CostsChartByProject.js";
import { CostsTableRecent } from "../components/costs/CostsTableRecent.js";

const DEFAULT_FILTERS: CostsQueryFilters = {
  range: "7d",
  scope: "company",
  refId: "",
  adapterName: "",
};

export const Costs: FC = () => {
  const { t } = useTranslation();
  const companyId = useActiveCompanyId();

  // Gastos is an Ajustes sub-page — use the same breadcrumb header as Conta /
  // Preferências / Avançado so the back affordance is consistent across screens.
  const backLink = <AjustesPageHeader title={t("ajustes.gastos.title")} />;
  const agents = useAgentsStore((s) => s.agents);
  const projects = useProjectsStore((s) => s.projects);

  const [filters, setFilters] = useState<CostsQueryFilters>(DEFAULT_FILTERS);
  const { result, loading, refresh } = useCostsQuery(companyId, filters);
  const { data: today } = useCostsToday(companyId);
  useCostsStream(refresh);

  const paddedBuckets = useMemo(() => {
    if (result.buckets.length === 0) return [];
    const sorted = [...result.buckets].sort((a, b) => a.bucketStart - b.bucketStart);
    const first = sorted[0]!.bucketStart;
    const last = sorted[sorted.length - 1]!.bucketStart + 86_400_000;
    return fillMissingDays(sorted, first, last);
  }, [result.buckets]);

  if (companyId === null) {
    return (
      <div className="p-8 max-w-5xl">
        {backLink}
        <h1 className="text-2xl font-bold text-brand-dark mb-1">{t("costs.title")}</h1>
        <p className="text-sm text-ink-muted">{t("costs.empty")}</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      {backLink}
      <h1 className="text-2xl font-bold text-brand-dark mb-1">{t("costs.title")}</h1>
      <p className="text-sm text-ink-muted mb-4">{t("costs.subtitle")}</p>

      <CostsHeader today={today} rangeTotals={result.total} />

      <CostsFilters
        filters={filters}
        agents={agents}
        projects={projects}
        onChange={setFilters}
        onClear={() => setFilters(DEFAULT_FILTERS)}
      />

      {loading && result.buckets.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("costs.loading")}</p>
      ) : (
        <>
          <CostsChartTimeSeries buckets={paddedBuckets} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CostsChartByAgent rows={result.byAgent} />
            <CostsChartByProject rows={result.byProject} />
          </div>
          <CostsTableRecent rows={result.byAgent} />
        </>
      )}
    </div>
  );
};

export default Costs;
