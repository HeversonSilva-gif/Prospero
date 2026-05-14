import type { FC } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../../stores/agents.js";
import { useActivityStream } from "../../hooks/useActivityStream.js";
import { renderDescription, type Lookups } from "../activity/activityRender.js";
import { useRelativeTime } from "../../hooks/useRelativeTime.js";
import type { ActivityEventRow, ActorKind } from "@dashboard-agent/shared";

const DOT_COLOR: Record<ActorKind, string> = {
  user: "bg-brand",
  agent: "bg-semantic-success",
  system: "bg-ink-soft",
};

type RowProps = { row: ActivityEventRow; lookups: Lookups };

const Row: FC<RowProps> = ({ row, lookups }) => {
  const { t } = useTranslation();
  const time = useRelativeTime(row.createdAt);
  const description = renderDescription(row, t, lookups);
  return (
    <li className="flex items-start gap-3 py-2 border-b border-surface-border last:border-b-0">
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${DOT_COLOR[row.actorKind]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-ink truncate">{description}</p>
        <p className="text-[10px] text-ink-soft">{time}</p>
      </div>
    </li>
  );
};

type Props = { companyId: string };

export const RecentActivityWidget: FC<Props> = ({ companyId }) => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const { rows, loading } = useActivityStream(companyId, {});
  const top = rows.slice(0, 10);

  const lookups: Lookups = useMemo(
    () => ({
      agentsById: new Map(agents.map((a) => [a.id, a.name])),
      currentUserName: t("activity.you"),
      systemName: t("activity.system"),
    }),
    [agents, t],
  );

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.recentActivity.title")}
        </h3>
        <Link to="/activity" className="text-xs text-brand hover:underline">
          {t("dashboard.recentActivity.viewAll")} →
        </Link>
      </div>
      {loading && rows.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.recentActivity.loading")}</p>
      ) : top.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.recentActivity.empty")}</p>
      ) : (
        <ul>
          {top.map((r) => (
            <Row key={r.id} row={r} lookups={lookups} />
          ))}
        </ul>
      )}
    </div>
  );
};
