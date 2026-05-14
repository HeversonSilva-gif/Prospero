import { useMemo, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Goal, GoalStatus } from "@dashboard-agent/shared";
import { buildGoalTree, type GoalTreeNode } from "../lib/goalsTree.js";

const STATUS_BADGE: Record<GoalStatus, string> = {
  draft: "bg-surface-border text-ink-muted",
  planning: "bg-brand-bg text-brand",
  proposed: "bg-semantic-warning/20 text-semantic-warning",
  approved: "bg-semantic-success/20 text-semantic-success",
  in_progress: "bg-semantic-success/20 text-semantic-success",
  achieved: "bg-semantic-success text-white",
  cancelled: "bg-surface-soft text-ink-soft",
};

const LEVEL_TINT: Record<string, string> = {
  company: "text-brand-dark",
  team: "text-brand",
  agent: "text-ink",
  task: "text-ink-muted",
};

const GoalRow: FC<{ node: GoalTreeNode; depth: number }> = ({ node, depth }) => {
  const { t } = useTranslation();
  return (
    <li>
      <Link
        to={`/goals/${node.id}`}
        className="flex items-center gap-2 px-3 py-2 rounded hover:bg-surface-soft group"
        style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}
      >
        <span
          className={`text-[10px] uppercase tracking-wide font-semibold ${LEVEL_TINT[node.level] ?? "text-ink-muted"}`}
        >
          {t(`goals.level.${node.level}`)}
        </span>
        <span className="text-sm text-ink flex-1 truncate group-hover:text-brand-dark">
          {node.title}
        </span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_BADGE[node.status]}`}
        >
          {t(`goals.status.${node.status}`)}
        </span>
      </Link>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <GoalRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
};

export const GoalsTree: FC<{ goals: Goal[] }> = ({ goals }) => {
  const tree = useMemo(() => buildGoalTree(goals), [goals]);
  return (
    <ul className="bg-surface-card border border-surface-border rounded divide-y divide-surface-border">
      {tree.map((node) => (
        <GoalRow key={node.id} node={node} depth={0} />
      ))}
    </ul>
  );
};
