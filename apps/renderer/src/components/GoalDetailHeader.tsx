import type { FC } from "react";
import type { Goal } from "@dashboard-agent/shared";

export const GoalDetailHeader: FC<{ goal: Goal }> = ({ goal }) => (
  <header>
    <h1 className="text-2xl font-bold text-brand-dark">{goal.title}</h1>
    <p className="text-xs text-ink-soft mt-1">
      {goal.level} · {goal.status}
    </p>
  </header>
);
