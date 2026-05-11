import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { AgentStats } from "@dashboard-agent/shared";
import { useAgentsStore } from "../../stores/agents.js";

type Props = { agentId: string };

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString();
};

export const StatsTab: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const fetchStats = useAgentsStore((s) => s.fetchStats);
  const [stats, setStats] = useState<AgentStats | null>(null);

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

  if (stats === null) {
    return <div className="p-4 text-xs text-ink-muted">…</div>;
  }
  return (
    <dl className="p-4 grid grid-cols-2 gap-3 text-xs">
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
      <div>
        <dt className="text-[10px] uppercase text-ink-soft font-semibold">
          {t("agent.stats.tokensIn")}
        </dt>
        <dd className="text-lg font-bold text-ink-muted mt-0.5">{stats.tokensIn ?? "—"}</dd>
        <p className="text-[10px] text-ink-soft italic">{t("agent.stats.m8Note")}</p>
      </div>
      <div>
        <dt className="text-[10px] uppercase text-ink-soft font-semibold">
          {t("agent.stats.tokensOut")}
        </dt>
        <dd className="text-lg font-bold text-ink-muted mt-0.5">{stats.tokensOut ?? "—"}</dd>
      </div>
    </dl>
  );
};
