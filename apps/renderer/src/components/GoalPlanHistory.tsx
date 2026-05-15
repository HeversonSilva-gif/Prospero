import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { GoalPlan, GoalPlanStatus } from "@prospero/shared";

const STATUS_BADGE: Record<GoalPlanStatus, string> = {
  proposed: "bg-brand-bg text-brand",
  approved: "bg-semantic-success/20 text-semantic-success",
  rejected: "bg-semantic-danger/20 text-semantic-danger",
  superseded: "bg-surface-soft text-ink-soft",
};

const HistoryRow: FC<{ plan: GoalPlan }> = ({ plan }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="bg-surface-card border border-surface-border rounded p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-brand-dark">
          {t("goals.plan.versionLabel", { version: plan.version })}
        </span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_BADGE[plan.status]}`}
        >
          {t(`goals.plan.status.${plan.status}`)}
        </span>
        <span className="text-xs text-ink-soft">{new Date(plan.proposedAt).toLocaleString()}</span>
        <span className="text-xs text-ink-muted ml-auto">
          {t("goals.plan.history.agentsCount", { count: plan.agentsToHire.length })} ·{" "}
          {t("goals.plan.history.issuesCount", { count: plan.issuesToCreate.length })}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-brand hover:underline"
        >
          {expanded ? t("goals.plan.collapse") : t("goals.plan.expand")}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 text-xs text-ink-muted space-y-2 pl-1">
          <p className="whitespace-pre-wrap">{plan.summary}</p>
          {plan.userFeedback !== null && plan.userFeedback.length > 0 && (
            <p>
              <span className="font-semibold uppercase tracking-wide text-ink-soft">
                {t("goals.plan.history.feedback")}:
              </span>{" "}
              <span className="whitespace-pre-wrap">{plan.userFeedback}</span>
            </p>
          )}
        </div>
      )}
    </li>
  );
};

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
        <HistoryRow key={p.id} plan={p} />
      ))}
    </ul>
  );
};
