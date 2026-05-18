import type { OrgPlan } from "@prospero/shared";

export type OrgPlanFilter = {
  includedRoleIndexes: Set<number>;
  includedAgentIndexes: Set<number>;
};

export type OrgPlanValidationError =
  | { kind: "agent-role-excluded"; agentIndex: number; roleIndex: number }
  | { kind: "agent-reports-to-excluded"; agentIndex: number; reportsToIndex: number };

// Validates that the include-filter selection produces an applicable org plan:
// every included agent must have its role included, and (when it reports to
// another agent rather than the CEO) its reports-to agent included. Returns the
// concrete violations so the UI can surface them and disable Approve.
export const validateOrgPlanSelection = (
  plan: OrgPlan,
  filter: OrgPlanFilter,
): OrgPlanValidationError[] => {
  const errors: OrgPlanValidationError[] = [];
  for (const agent of plan.agents) {
    if (!filter.includedAgentIndexes.has(agent.index)) continue;
    if (!filter.includedRoleIndexes.has(agent.roleIndex)) {
      errors.push({
        kind: "agent-role-excluded",
        agentIndex: agent.index,
        roleIndex: agent.roleIndex,
      });
    }
    if (agent.reportsToIndex !== "CEO" && !filter.includedAgentIndexes.has(agent.reportsToIndex)) {
      errors.push({
        kind: "agent-reports-to-excluded",
        agentIndex: agent.index,
        reportsToIndex: agent.reportsToIndex,
      });
    }
  }
  return errors;
};
