// M12 PR-D2: the CEO org architect's proposal types. An org plan proposes new
// roles, agents, and a reporting hierarchy for the user to review and approve.
// Index-based (0..N-1) like the goal plan: the CEO refers to not-yet-created
// entities by index; the executor resolves indexes to real ids.

export type ProposedRole = {
  index: number;
  name: string;
  description: string;
  charter: string; // full 8-section markdown, written by the CEO
  model: string;
  capabilities: string[];
  icon: string | null;
};

export type ProposedAgent = {
  index: number;
  name: string;
  roleIndex: number; // → a ProposedRole.index
  reportsToIndex: number | "CEO"; // → a ProposedAgent.index, or the existing CEO
  rationale: string;
};

export type OrgPlanStatus = "critiquing" | "proposed" | "approved" | "rejected" | "superseded";

export type OrgPlan = {
  id: string;
  companyId: string;
  proposedByAgentId: string;
  summary: string;
  roles: ProposedRole[];
  agents: ProposedAgent[];
  status: OrgPlanStatus;
  userFeedback: string | null;
  proposedAt: number;
  decidedAt: number | null;
};

// Result of applyOrgPlan — mirrors ExecutePlanResult's discriminated shape.
export type ApplyOrgPlanResult =
  | { ok: true; createdRoleIds: string[]; hiredAgentIds: string[] }
  | { ok: false; error: string; failedAtStep: string };
