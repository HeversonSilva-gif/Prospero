// M8.5 — Goal + GoalPlan shared types.
// Zod schemas live in apps/main/src/schemas/goalPlan.ts (zod is a runtime dep
// that cannot live in shared — see project_m7_6_lessons.md fix #1: zod
// in shared breaks preload sandbox bundle).

import type { IssuePriority } from "./issue.js";
export type { IssuePriority };

export type GoalLevel = "company" | "team" | "agent" | "task";

export type GoalStatus =
  | "draft"
  | "planning"
  | "proposed"
  | "approved"
  | "in_progress"
  | "achieved"
  | "cancelled";

export type GoalPlanStatus = "proposed" | "approved" | "rejected" | "superseded";

export type RiskSeverity = "low" | "medium" | "high";

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentGoalId: string | null;
  ownerAgentId: string | null;
  budgetMaxTokens: number | null;
  deadline: number | null;
  successCriteria: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentToHire {
  index: number;
  name: string;
  roleTemplateId: string;
  model: string;
  personaSummary: string;
  capabilities: string[];
  reportsToIndex: number | "CEO";
  rationale: string;
}

export interface IssueToCreate {
  index: number;
  title: string;
  description: string;
  priority: IssuePriority;
  assigneeIndex: number | "CEO";
  estimatedTokens: number;
  dependsOnIndexes: number[];
  rationale: string;
}

export interface Risk {
  description: string;
  mitigation: string;
  severity: RiskSeverity;
}

export interface GoalPlan {
  id: string;
  goalId: string;
  version: number;
  proposedByAgentId: string;
  summary: string;
  agentsToHire: AgentToHire[];
  issuesToCreate: IssueToCreate[];
  estimatedTotalTokens: number | null;
  estimatedDurationDays: number | null;
  estimatedCostCents: number | null;
  risks: Risk[];
  status: GoalPlanStatus;
  userFeedback: string | null;
  proposedAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
}

export interface GoalWithPlan extends Goal {
  currentPlan: GoalPlan | null;
  history: GoalPlan[];
}

export type ExecutePlanResult =
  | { ok: true; hiredAgentIds: string[]; createdIssueIds: string[] }
  | { ok: false; error: string; failedAtStep: string };

// M8.6 — Narrated execution state.
// Persisted as JSON in goals.execution_state_json. NULL = goal not in
// narrated execution. Cleared on finalize_goal_execution (success or abort).
export type ExecutionStateStep =
  | "starting"
  | "hiring"
  | "creating_issues"
  | "commenting"
  | "finalizing";

export interface ExecutionState {
  planId: string;
  mode: "narrated";
  includeAgentIndexes: number[] | null;
  includeIssueIndexes: number[] | null;
  agentIndexToId: Record<number, string>;
  issueIndexToId: Record<number, string>;
  step: ExecutionStateStep;
  startedAt: number;
  ceoId: string;
  threadId: string;
}

export interface CreateGoalInput {
  companyId: string;
  title: string;
  description?: string | null;
  level?: GoalLevel;
  parentGoalId?: string | null;
  ownerAgentId?: string | null;
  budgetMaxTokens?: number | null;
  deadline?: number | null;
  successCriteria?: string | null;
}
