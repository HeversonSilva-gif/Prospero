import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { AgentStats } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { useCostsQuery } from "../../hooks/useCostsQuery.js";
import { useActiveCompanyId } from "../../hooks/useActiveCompanyId.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";
import { BudgetSection } from "./BudgetSection.js";
import { Section, LoadingState } from "../ui/index.js";
import { TrustHistoryPanel } from "./TrustHistoryPanel.js";

type Props = { agentId: string };

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString();
};

/** Single stat cell — label on top, value below */
const StatCell: FC<{ label: string; value: string; accent?: boolean; muted?: boolean }> = ({
  label,
  value,
  accent = false,
  muted = false,
}) => (
  <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-soft border border-surface-border">
    <span className="text-[10px] uppercase tracking-wide font-semibold text-ink-soft">{label}</span>
    <span
      className={`text-xl font-bold tabular-nums leading-none ${
        accent ? "text-brand-dark" : muted ? "text-ink-muted" : "text-ink"
      }`}
    >
      {value}
    </span>
  </div>
);

export const StatsTab: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const fetchStats = useAgentsStore((s) => s.fetchStats);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const companyId = useActiveCompanyId();
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
    return (
      <div className="p-6">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Two-column layout: metrics left, budget right */}
      <div className="grid grid-cols-[1fr_1fr] gap-6 items-start">
        {/* Left column: activity metrics + 7-day breakdown */}
        <div className="space-y-5">
          <Section title={t("agent.studio.stats.activity")}>
            <div className="grid grid-cols-2 gap-3">
              <StatCell label={t("agent.stats.turns")} value={String(stats.turns)} accent />
              <StatCell
                label={t("agent.stats.lastActivity")}
                value={formatTimestamp(stats.lastActivityAt)}
              />
            </div>
          </Section>

          <Section title={t("agent.stats.spark7d")}>
            <div className="grid grid-cols-2 gap-3">
              <StatCell
                label={t("agent.stats.tokensIn")}
                value={formatTokens(sumByKey("inputTokens"))}
              />
              <StatCell
                label={t("agent.stats.tokensOut")}
                value={formatTokens(sumByKey("outputTokens"))}
              />
              <StatCell
                label={t("agent.stats.tokensCache")}
                value={formatTokens(sumCache())}
                muted
              />
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-soft border border-surface-border">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-ink-soft">
                  {t("agent.stats.costTotal")}
                </span>
                <div className="flex items-end justify-between gap-2">
                  <span className="text-xl font-bold tabular-nums leading-none text-brand-dark">
                    {formatCents(result.total.cents)}
                  </span>
                  <Link
                    to="/costs"
                    className="text-[10px] text-brand hover:underline shrink-0 leading-none mb-0.5"
                  >
                    {t("agent.stats.viewInCosts")}
                  </Link>
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* Right column: budget */}
        <div>
          <Section title={t("agent.studio.stats.budget")}>
            <BudgetSection agentId={agentId} />
          </Section>
        </div>
      </div>

      {/* Full-width trust history below the two columns. */}
      <TrustHistoryPanel agentId={agentId} />
    </div>
  );
};
