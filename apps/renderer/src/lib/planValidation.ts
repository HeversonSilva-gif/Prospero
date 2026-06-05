import type { GoalPlan } from "@prospero/shared";

export type PlanValidationError =
  | { kind: "issue-assignee-excluded"; issueIndex: number; agentIndex: number }
  | { kind: "issue-dep-excluded"; issueIndex: number; depIndex: number }
  | { kind: "agent-reports-to-excluded"; agentIndex: number; reportsToIndex: number };

export type PlanFilter = {
  includedAgentIndexes: Set<number>;
  includedIssueIndexes: Set<number>;
};

// Validates that the current include-filter selection produces an executable
// plan: every included issue must have its assignee included (or 'CEO'), every
// included issue must have its dependency-issues included, and every included
// agent must have its reports_to included (or 'CEO'). Returns a list of
// concrete violations so the UI can surface them.
export const validatePlanSelection = (
  plan: GoalPlan,
  filter: PlanFilter,
): PlanValidationError[] => {
  const errors: PlanValidationError[] = [];

  for (const a of plan.agentsToHire) {
    if (!filter.includedAgentIndexes.has(a.index)) continue;
    if (a.reportsToIndex !== "CEO" && !filter.includedAgentIndexes.has(a.reportsToIndex)) {
      errors.push({
        kind: "agent-reports-to-excluded",
        agentIndex: a.index,
        reportsToIndex: a.reportsToIndex,
      });
    }
  }

  for (const i of plan.issuesToCreate) {
    if (!filter.includedIssueIndexes.has(i.index)) continue;
    // Only a fresh-hire (numeric) assignee can be excluded by the agent filter.
    // "CEO" and existing-team-member assignees are always available.
    if (typeof i.assigneeIndex === "number" && !filter.includedAgentIndexes.has(i.assigneeIndex)) {
      errors.push({
        kind: "issue-assignee-excluded",
        issueIndex: i.index,
        agentIndex: i.assigneeIndex,
      });
    }
    for (const dep of i.dependsOnIndexes) {
      if (!filter.includedIssueIndexes.has(dep)) {
        errors.push({ kind: "issue-dep-excluded", issueIndex: i.index, depIndex: dep });
      }
    }
  }

  return errors;
};

export type PlanEstimates = {
  totalTokens: number;
  durationDays: number | null;
  costCents: number | null;
};

// Recomputes estimates from the included subset. When the plan provides
// estimatedTotalTokens but the filter excludes some issues, scale token total
// proportionally by sum of issue.estimatedTokens; cost scales by the same ratio.
// Duration is kept as the plan-level estimate (we don't have a per-issue duration).
export const computeFilteredEstimates = (plan: GoalPlan, filter: PlanFilter): PlanEstimates => {
  const includedIssues = plan.issuesToCreate.filter((i) =>
    filter.includedIssueIndexes.has(i.index),
  );
  const sumIncluded = includedIssues.reduce((acc, i) => acc + i.estimatedTokens, 0);
  const sumAll = plan.issuesToCreate.reduce((acc, i) => acc + i.estimatedTokens, 0);

  let totalTokens = sumIncluded;
  let costCents: number | null = null;

  if (plan.estimatedTotalTokens !== null) {
    if (sumAll > 0) {
      const ratio = sumIncluded / sumAll;
      totalTokens = Math.round(plan.estimatedTotalTokens * ratio);
      if (plan.estimatedCostCents !== null) {
        costCents = Math.round(plan.estimatedCostCents * ratio);
      }
    } else {
      // No per-issue tokens to ratio against — use plan-level numbers as-is.
      totalTokens = plan.estimatedTotalTokens;
      costCents = plan.estimatedCostCents;
    }
  } else if (plan.estimatedCostCents !== null && sumAll > 0) {
    const ratio = sumIncluded / sumAll;
    costCents = Math.round(plan.estimatedCostCents * ratio);
  }

  return {
    totalTokens,
    durationDays: plan.estimatedDurationDays,
    costCents,
  };
};
