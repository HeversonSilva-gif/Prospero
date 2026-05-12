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
