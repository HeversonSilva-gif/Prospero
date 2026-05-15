import type { Agent, Issue, Goal } from "@prospero/shared";

const ACTIVE_AGENT_STATUSES = new Set(["thinking", "working", "waiting"]);
const ACTIVE_ISSUE_STATUSES = new Set(["doing", "review"]);

export const selectActiveAgents = (agents: Agent[]): Agent[] =>
  agents.filter((a) => ACTIVE_AGENT_STATUSES.has(a.status));

export const selectActiveIssues = (issues: Issue[]): Issue[] =>
  issues.filter((i) => ACTIVE_ISSUE_STATUSES.has(i.status));

export const countIssuesByProject = (issues: Issue[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const i of issues) {
    const key = i.projectId ?? "";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

export const selectInProgressGoals = (goals: Goal[], limit: number): Goal[] =>
  goals
    .filter((g) => g.status === "in_progress")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
