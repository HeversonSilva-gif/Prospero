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

export const ActiveAgentsPanelWidget: FC = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const active = selectActiveAgents(agents);

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">
        {t("dashboard.activePanel.title")}
      </h3>
      {active.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.activePanel.empty")}</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {active.map((a) => {
            const showAction = a.currentAction !== null && a.currentAction !== "";
            return (
              <li key={a.id} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[a.status] ?? "bg-ink-soft"}`}
                  />
                  <Link to={`/agents/${a.id}`} className="text-ink hover:text-brand">
                    {a.name}
                  </Link>
                  <span className="text-ink-soft text-[10px] uppercase">{a.status}</span>
                </span>
                {showAction && (
                  <span className="pl-3.5 text-[11px] italic text-ink-soft truncate">
                    {a.currentAction}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
