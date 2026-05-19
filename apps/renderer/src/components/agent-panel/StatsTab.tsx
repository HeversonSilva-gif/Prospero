import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { AgentStats } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { useCostsQuery } from "../../hooks/useCostsQuery.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";
import { BudgetSection } from "./BudgetSection.js";

type Props = { agentId: string };

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString();
};

const useCompanyId = (): string | null => {
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const companies = await window.prospero.companies.list();
      if (companies.length > 0) setCompanyId(companies[0]!.id);
    })();
  }, []);
  return companyId;
};

export const StatsTab: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const fetchStats = useAgentsStore((s) => s.fetchStats);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const companyId = useCompanyId();
  const { result } = useCostsQuery(companyId, {
    range: "7d",
    scope: "agent",
    refId: agentId,
    adapterName: "",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await fetchStats(agentId);
      if (!cancelled) setStats(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, fetchStats]);

  const sumByKey = (key: "inputTokens" | "outputTokens"): number =>
    result.buckets.reduce((acc, b) => acc + b[key], 0);
  const sumCache = (): number =>
    result.buckets.reduce((acc, b) => acc + b.cacheCreationTokens + b.cacheReadTokens, 0);

  if (stats === null) {
    return <div className="p-4 text-xs text-ink-muted">…</div>;
  }
  return (
    <div className="p-4 space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-[10px] uppercase text-ink-soft font-semibold">
            {t("agent.stats.turns")}
          </dt>
          <dd className="text-lg font-bold text-brand-dark mt-0.5">{stats.turns}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-ink-soft font-semibold">
            {t("agent.stats.lastActivity")}
          </dt>
          <dd className="text-[11px] text-ink mt-1.5">{formatTimestamp(stats.lastActivityAt)}</dd>
        </div>
      </dl>
      <div className="border-t border-surface-border pt-3">
        <div className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.stats.spark7d")}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-[10px] uppercase text-ink-soft font-semibold">
              {t("agent.stats.tokensIn")}
            </dt>
            <dd className="text-base font-bold text-ink mt-0.5 tabular-nums">
              {formatTokens(sumByKey("inputTokens"))}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-ink-soft font-semibold">
              {t("agent.stats.tokensOut")}
            </dt>
            <dd className="text-base font-bold text-ink mt-0.5 tabular-nums">
              {formatTokens(sumByKey("outputTokens"))}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-ink-soft font-semibold">
              {t("agent.stats.tokensCache")}
            </dt>
            <dd className="text-base font-bold text-ink-muted mt-0.5 tabular-nums">
              {formatTokens(sumCache())}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-ink-soft font-semibold">
              {t("agent.stats.costTotal")}
            </dt>
            <dd className="text-base font-bold text-brand-dark mt-0.5 tabular-nums">
              {formatCents(result.total.cents)}
            </dd>
          </div>
        </dl>
      </div>
      <Link to="/costs" className="text-xs text-brand hover:underline block">
        {t("agent.stats.viewInCosts")}
      </Link>
      <BudgetSection agentId={agentId} />
    </div>
  );
};
