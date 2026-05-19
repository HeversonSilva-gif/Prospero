import type { BudgetPeriod } from "./agent.js";

export type CostBucket = {
  bucketStart: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costCents: number;
};

export type CostAgentTotal = {
  agentId: string;
  agentName: string;
  tokens: number;
  cents: number;
};

export type CostProjectTotal = {
  projectId: string | null;
  projectName: string | null;
  tokens: number;
  cents: number;
};

export type CostsQueryScope = "company" | "agent" | "project" | "issue";
export type CostsBucket = "day" | "hour";

export type CostsQueryInput = {
  companyId: string;
  scope: CostsQueryScope;
  refId?: string;
  adapterName?: string;
  from: number;
  to: number;
  bucket: CostsBucket;
};

export type CostsQueryResult = {
  buckets: CostBucket[];
  byAgent: CostAgentTotal[];
  byProject: CostProjectTotal[];
  total: { tokens: number; cents: number };
};

export type CostsAggregateTodayResult = {
  totalCents: number;
  totalTokens: number;
  percentMax: number;
  byAgent: CostAgentTotal[];
};

export type CostBudgets = {
  maxTokensPerDayPerAgent: number;
  maxTokensPerIssue: number;
  rateLimitWindowTokens: number;
  rateLimitWindowHours: number;
};

// M12 PR-E2: live snapshot of an agent's per-agent budget utilisation, for
// the Budget section in the Stats tab. Derived from cost_events.
export type AgentBudgetStatus = {
  period: BudgetPeriod;
  tokenTotal: number;
  tokenLimit: number | null;
  usdTotalCents: number;
  usdLimitCents: number | null;
  adapterIsCostBearing: boolean;
};

// M12 PR-E1: a "run" is one turn — derived directly from a cost_events row.
// There is no agent_runs table; the Runs tab is a read-model over cost_events.
export type AgentRunRow = {
  id: string;
  agentId: string;
  occurredAt: number;
  model: string | null;
  adapterName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costCentsEstimate: number;
  issueId: string | null;
  sessionId: string | null;
};
