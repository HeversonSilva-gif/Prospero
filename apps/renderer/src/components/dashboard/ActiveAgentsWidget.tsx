import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../../stores/agents.js";
import { selectActiveAgents } from "../../lib/dashboard/selectors.js";

const STATUS_COLOR: Record<string, string> = {
  thinking: "bg-brand",
  working: "bg-semantic-success",
  waiting: "bg-semantic-warning",
};

export const ActiveAgentsWidget: FC = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const active = selectActiveAgents(agents);
  const top = active.slice(0, 3);

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.activeAgents.title")}
        </h3>
        <span className="text-xl font-bold text-brand-dark">{active.length}</span>
      </div>
      {active.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.activeAgents.empty")}</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {top.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[a.status] ?? "bg-ink-soft"}`}
              />
              <Link to={`/agents/${a.id}`} className="truncate text-ink hover:text-brand">
                {a.name}
              </Link>
              <span className="text-ink-soft text-[10px] uppercase">{a.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
