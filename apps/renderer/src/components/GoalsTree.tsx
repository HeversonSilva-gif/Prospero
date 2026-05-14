import type { FC } from "react";
import type { Goal } from "@dashboard-agent/shared";

export const GoalsTree: FC<{ goals: Goal[] }> = ({ goals }) => (
  <ul className="space-y-2">
    {goals.map((g) => (
      <li key={g.id} className="bg-surface-card rounded p-3 border border-surface-border">
        <span className="text-sm font-semibold text-brand-dark">{g.title}</span>
        <span className="text-xs text-ink-soft ml-2">[{g.status}]</span>
      </li>
    ))}
  </ul>
);
