import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Goal, GoalStatus } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";

const STATUS_BADGE: Record<GoalStatus, string> = {
  draft: "bg-surface-border text-ink-muted",
  planning: "bg-brand-bg text-brand",
  proposed: "bg-semantic-warning/20 text-semantic-warning",
  approved: "bg-semantic-success/20 text-semantic-success",
  in_progress: "bg-semantic-success/20 text-semantic-success",
  achieved: "bg-semantic-success text-white",
  cancelled: "bg-surface-soft text-ink-soft",
};

const formatDeadline = (deadline: number | null): string | null => {
  if (deadline === null) return null;
  return new Date(deadline).toLocaleDateString();
};

export const GoalDetailHeader: FC<{ goal: Goal }> = ({ goal }) => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const owner = goal.ownerAgentId !== null ? agents.find((a) => a.id === goal.ownerAgentId) : null;
  const deadline = formatDeadline(goal.deadline);

  return (
    <header className="bg-surface-card border border-surface-border rounded p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h1 className="text-2xl font-bold text-brand-dark flex-1">{goal.title}</h1>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded ${STATUS_BADGE[goal.status]}`}
        >
          {t(`goals.status.${goal.status}`)}
        </span>
      </div>

      {goal.description !== null && goal.description.length > 0 && (
        <p className="text-sm text-ink-muted whitespace-pre-wrap mb-3">{goal.description}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="text-ink-soft uppercase tracking-wide font-semibold">
            {t("goals.detail.fields.level")}
          </dt>
          <dd className="text-ink">{t(`goals.level.${goal.level}`)}</dd>
        </div>

        <div className="flex gap-2">
          <dt className="text-ink-soft uppercase tracking-wide font-semibold">
            {t("goals.detail.fields.owner")}
          </dt>
          <dd className="text-ink">
            {owner !== undefined && owner !== null ? owner.name : t("goals.detail.fields.noOwner")}
          </dd>
        </div>

        {deadline !== null && (
          <div className="flex gap-2">
            <dt className="text-ink-soft uppercase tracking-wide font-semibold">
              {t("goals.detail.fields.deadline")}
            </dt>
            <dd className="text-ink">{deadline}</dd>
          </div>
        )}

        {goal.budgetMaxTokens !== null && (
          <div className="flex gap-2">
            <dt className="text-ink-soft uppercase tracking-wide font-semibold">
              {t("goals.detail.fields.budget")}
            </dt>
            <dd className="text-ink">
              {goal.budgetMaxTokens.toLocaleString()} {t("goals.detail.fields.tokens")}
            </dd>
          </div>
        )}
      </dl>

      {goal.successCriteria !== null && goal.successCriteria.length > 0 && (
        <div className="mt-3 pt-3 border-t border-surface-border">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-soft mb-1">
            {t("goals.detail.fields.criteria")}
          </p>
          <p className="text-sm text-ink whitespace-pre-wrap">{goal.successCriteria}</p>
        </div>
      )}
    </header>
  );
};
