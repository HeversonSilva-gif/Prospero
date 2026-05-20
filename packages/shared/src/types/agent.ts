import type { TrustTier } from "./trust.js";

export type AgentMode = "supervised" | "auto";
export type BudgetPeriod = "daily" | "monthly";
export type AgentStatus =
  | "idle"
  | "thinking"
  | "working"
  | "waiting"
  | "error"
  | "paused"
  | "terminated";

// Sentinel for allowedProjects representing "explicit no access".
// allowedProjects = [] means "all projects allowed" (no restriction). To express
// "this agent has access to zero projects" we store [NO_ACCESS_SENTINEL]. The
// security gate's includes() check against real project IDs never matches it,
// so access is correctly denied.
export const NO_ACCESS_SENTINEL = "__none__";

export type Agent = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  systemPrompt: string;
  mode: AgentMode;
  alwaysOn: boolean;
  status: AgentStatus;
  claudeSessionId: string | null;
  currentAction: string | null;
  allowedProjects: string[];
  model: string;
  capabilities: string[];
  templateId: string | null;
  reportsTo: string | null;
  adapterName: string;
  pausedAt: number | null;
  terminatedAt: number | null;
  pauseReason: string | null;
  budgetTokensLimit: number | null;
  budgetUsdLimit: number | null; // cents
  budgetPeriod: BudgetPeriod;
  canHire: boolean;
  canAssign: boolean;
  trustTier: TrustTier;
};

export type AgentStats = {
  turns: number;
  tokensIn: number | null;
  tokensOut: number | null;
  lastActivityAt: number | null;
};
