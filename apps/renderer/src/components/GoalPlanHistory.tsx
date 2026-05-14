import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { GoalPlan } from "@dashboard-agent/shared";

export const GoalPlanHistory: FC<{ plans: GoalPlan[] }> = ({ plans }) => {
  const { t } = useTranslation();
  if (plans.length === 0) {
    return (
      <p className="text-sm text-ink-muted bg-surface-soft rounded p-4">
        {t("goals.plan.history.empty")}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {plans.map((p) => (
        <li key={p.id} className="bg-surface-card rounded p-3 border border-surface-border">
          <span className="text-sm font-semibold">v{p.version}</span>
          <span className="text-xs text-ink-soft ml-2">{p.status}</span>
        </li>
      ))}
    </ul>
  );
};
