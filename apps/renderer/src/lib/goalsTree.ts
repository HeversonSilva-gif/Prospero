import type { Goal } from "@dashboard-agent/shared";

export type GoalTreeNode = Goal & { children: GoalTreeNode[] };

// Build a parent-child tree from a flat goal list. Goals whose parentGoalId
// references an unknown id (e.g., parent in another company or deleted) are
// promoted to roots so they don't disappear silently.
export const buildGoalTree = (goals: Goal[]): GoalTreeNode[] => {
  const byId = new Map<string, GoalTreeNode>();
  for (const g of goals) byId.set(g.id, { ...g, children: [] });
  const roots: GoalTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentGoalId !== null && byId.has(node.parentGoalId)) {
      byId.get(node.parentGoalId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
};
