import type { Goal } from "@dashboard-agent/shared";

export const formatGoalPlanRequest = (goal: Goal, feedback?: string): string => {
  const lines: string[] = ["[GOAL_PLAN_REQUEST]"];
  lines.push(`goal_id=${goal.id}`);
  lines.push(`title=${goal.title}`);
  if (goal.description !== null && goal.description !== "") {
    lines.push(`description=${goal.description}`);
  }
  lines.push(`level=${goal.level}`);
  if (goal.budgetMaxTokens !== null) {
    lines.push(`budget_max_tokens=${goal.budgetMaxTokens}`);
  }
  if (goal.deadline !== null) {
    lines.push(`deadline=${goal.deadline}`);
  }
  if (goal.successCriteria !== null && goal.successCriteria !== "") {
    lines.push(`success_criteria=${goal.successCriteria}`);
  }
  if (feedback !== undefined && feedback.trim() !== "") {
    lines.push("");
    lines.push(`[FEEDBACK] ${feedback}`);
  }
  return lines.join("\n");
};
