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
  /** Unix timestamp (ms) when mode was last set to 'auto'. Null when in supervised mode. */
  autoModeSetAt: number | null;
  /** Unix timestamp (ms) of the last DB write to this agent row. */
  updatedAt?: number;
};

export type AgentStats = {
  turns: number;
  tokensIn: number | null;
  tokensOut: number | null;
  lastActivityAt: number | null;
};

// The canonical CEO marker. The CEO is the role_templates row "role-ceo"
// (seeded by post-migration 0004; its rich charter lives in SEED_CHARTERS and
// is materialized by resolveRoleCharter, whose regex requires the "role-"
// prefix). Legacy/demo data may instead carry role "ceo"/"CEO". Every CEO
// check — goal planning, org plans, Pedir algo, TELOS, build-args, charter
// seeding — MUST go through this helper so the marker never drifts again.
export const CEO_TEMPLATE_ID = "role-ceo";

export const isCeoAgent = (agent: { role: string; templateId: string | null }): boolean =>
  agent.templateId === CEO_TEMPLATE_ID || agent.role.toLowerCase() === "ceo";

// The authoritative "this agent is gone" marker is `terminatedAt`, NOT `status`.
// `terminate()` sets status='terminated', but other paths (rate-limit pause/resume,
// a code-0 process exit) can reset a terminated agent's status back to 'idle',
// leaving a zombie row that a status-only filter would happily select. Selecting
// a terminated agent as CEO and force-spawning it routed approvals to a corpse
// while the live replacement sat idle — the team never converged. Always gate on
// `terminatedAt === null` at every consumption point.
export const isActiveAgent = (agent: { status: string; terminatedAt: number | null }): boolean =>
  agent.terminatedAt === null && agent.status !== "terminated" && agent.status !== "paused";

export const findActiveCeo = <
  T extends {
    role: string;
    templateId: string | null;
    status: string;
    terminatedAt: number | null;
  },
>(
  agents: readonly T[],
): T | null => agents.find((a) => isCeoAgent(a) && isActiveAgent(a)) ?? null;
