import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useGoalsStore } from "../../stores/goals.js";
import { selectInProgressGoals } from "../../lib/dashboard/selectors.js";

export const GoalsProgressWidget: FC = () => {
  const { t } = useTranslation();
  const goals = useGoalsStore((s) => s.goals);
  const top = selectInProgressGoals(goals, 3);

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">{t("dashboard.goals.title")}</h3>
        <Link to="/goals" className="text-xs text-brand hover:underline">
          {t("dashboard.goals.viewAll")} →
        </Link>
      </div>
      {top.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.goals.empty")}</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {top.map((g) => (
            <li key={g.id}>
              <Link
                to={`/goals/${g.id}`}
                className="block truncate text-ink hover:text-brand"
                title={g.title}
              >
                {g.title}
              </Link>
              <span className="text-[10px] text-ink-soft uppercase tracking-wide">
                {t(`goals.status.${g.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
