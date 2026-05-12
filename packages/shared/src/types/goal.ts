// M8.5 — Goal + GoalPlan shared types.
// Zod schemas live in packages/shared/src/schemas/goalPlan.ts.

import type { IssuePriority } from "./issue.js";

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
  skills: string[];
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
