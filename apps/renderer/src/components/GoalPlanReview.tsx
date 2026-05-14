import type { FC } from "react";
import type { Goal, GoalPlan } from "@dashboard-agent/shared";

export const GoalPlanReview: FC<{ plan: GoalPlan; goal: Goal }> = ({ plan }) => (
  <div className="bg-surface-card rounded p-4 border border-surface-border">
    <p className="text-sm font-semibold text-brand-dark">
      Plan v{plan.version} ({plan.status})
    </p>
    <p className="text-xs text-ink-muted mt-2 whitespace-pre-wrap">{plan.summary}</p>
  </div>
);
