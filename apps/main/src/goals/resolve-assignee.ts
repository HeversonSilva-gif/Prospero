import type { PlanAssigneeRef } from "@prospero/shared";

// Resolves a plan issue's assignee reference to a concrete agent id, shared by
// both execution paths (atomic executor.ts + narrated create_issue_for_plan).
// The reference is one of: the CEO, a fresh hire (index into the plan's
// agentsToHire, resolved via `freshHire`), or an EXISTING team member by id
// (validated against the live roster via `existingAgent`). The existing-agent
// form is what lets a plan reuse the company's current team.
export type AssigneeResolveDeps = {
  ceoId: string;
  companyId: string;
  // Maps a fresh-hire plan index to the id it was created/hired as (undefined if
  // not hired — e.g. excluded by a partial-execution filter).
  freshHire: (index: number) => string | undefined;
  // Looks up an existing agent by id (null if absent).
  existingAgent: (id: string) => { companyId: string; terminatedAt: number | null } | null;
};

export const resolvePlanAssignee = (ref: PlanAssigneeRef, deps: AssigneeResolveDeps): string => {
  if (ref === "CEO") return deps.ceoId;
  if (typeof ref === "number") {
    const id = deps.freshHire(ref);
    if (id === undefined) {
      throw new Error(`assignee #${String(ref)} not yet hired (likely excluded by filter)`);
    }
    return id;
  }
  // Existing team member by id — validate it is a live agent in this company.
  const agent = deps.existingAgent(ref.existingAgentId);
  if (agent === null) {
    throw new Error(`assignee agent ${ref.existingAgentId} not found`);
  }
  if (agent.companyId !== deps.companyId) {
    throw new Error(`assignee agent ${ref.existingAgentId} belongs to another company`);
  }
  if (agent.terminatedAt !== null) {
    throw new Error(`assignee agent ${ref.existingAgentId} is terminated`);
  }
  return ref.existingAgentId;
};
