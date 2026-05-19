// 4 IPC handlers for the /costs route + Dashboard widget + Settings Budgets.
// Aggregation queries run directly against cost_events; budgets via the
// dedicated repository.

import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import type {
  CostsQueryInput,
  CostsQueryResult,
  CostsAggregateTodayResult,
  CostBudgets,
  CostBucket,
  CostAgentTotal,
  CostProjectTotal,
  AgentBudgetStatus,
} from "@prospero/shared";
import { createBudgetsRepository } from "../costs/budgets-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createCostsRepository } from "../costs/repository.js";

const bucketMs = (b: "day" | "hour"): number => (b === "day" ? 86_400_000 : 3_600_000);

const queryCompany = (db: Database.Database, input: CostsQueryInput): CostsQueryResult => {
  const step = bucketMs(input.bucket);
  // Use fully-qualified column refs so joined queries don't get ambiguous-column
  // errors (agents/projects also have company_id).
  const conditions: string[] = [
    "cost_events.company_id = ?",
    "cost_events.occurred_at >= ?",
    "cost_events.occurred_at < ?",
  ];
  const params: unknown[] = [input.companyId, input.from, input.to];
  if (input.scope === "agent" && input.refId !== undefined) {
    conditions.push("cost_events.agent_id = ?");
    params.push(input.refId);
  } else if (input.scope === "project" && input.refId !== undefined) {
    conditions.push("cost_events.project_id = ?");
    params.push(input.refId);
  } else if (input.scope === "issue" && input.refId !== undefined) {
    conditions.push("cost_events.issue_id = ?");
    params.push(input.refId);
  }
  if (input.adapterName !== undefined) {
    conditions.push("cost_events.adapter_name = ?");
    params.push(input.adapterName);
  }
  const where = conditions.join(" AND ");

  const bucketRows = db
    .prepare(
      `SELECT
         (cost_events.occurred_at - (cost_events.occurred_at % ${String(step)})) AS bucket_start,
         COALESCE(SUM(cost_events.input_tokens), 0) AS input_tokens,
         COALESCE(SUM(cost_events.output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cost_events.cache_creation_tokens), 0) AS cache_creation_tokens,
         COALESCE(SUM(cost_events.cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cost_events.cost_cents_estimate), 0) AS cost_cents
       FROM cost_events WHERE ${where}
       GROUP BY bucket_start
       ORDER BY bucket_start ASC`,
    )
    .all(...params) as Array<{
    bucket_start: number;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    cost_cents: number;
  }>;
  const buckets: CostBucket[] = bucketRows.map((r) => ({
    bucketStart: r.bucket_start,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    cacheReadTokens: r.cache_read_tokens,
    costCents: r.cost_cents,
  }));

  const agentRows = db
    .prepare(
      `SELECT cost_events.agent_id AS agent_id,
              COALESCE(agents.name, '(deleted)') AS agent_name,
              COALESCE(SUM(cost_events.input_tokens + cost_events.output_tokens + cost_events.cache_creation_tokens + cost_events.cache_read_tokens), 0) AS tokens,
              COALESCE(SUM(cost_events.cost_cents_estimate), 0) AS cents
       FROM cost_events
       LEFT JOIN agents ON agents.id = cost_events.agent_id
       WHERE ${where} AND cost_events.agent_id IS NOT NULL
       GROUP BY cost_events.agent_id, agents.name
       ORDER BY tokens DESC
       LIMIT 10`,
    )
    .all(...params) as Array<{
    agent_id: string;
    agent_name: string;
    tokens: number;
    cents: number;
  }>;
  const byAgent: CostAgentTotal[] = agentRows.map((r) => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    tokens: r.tokens,
    cents: r.cents,
  }));

  const projectRows = db
    .prepare(
      `SELECT cost_events.project_id AS project_id,
              projects.name AS project_name,
              COALESCE(SUM(cost_events.input_tokens + cost_events.output_tokens + cost_events.cache_creation_tokens + cost_events.cache_read_tokens), 0) AS tokens,
              COALESCE(SUM(cost_events.cost_cents_estimate), 0) AS cents
       FROM cost_events
       LEFT JOIN projects ON projects.id = cost_events.project_id
       WHERE ${where}
       GROUP BY cost_events.project_id, projects.name
       ORDER BY tokens DESC`,
    )
    .all(...params) as Array<{
    project_id: string | null;
    project_name: string | null;
    tokens: number;
    cents: number;
  }>;
  const byProject: CostProjectTotal[] = projectRows.map((r) => ({
    projectId: r.project_id,
    projectName: r.project_name,
    tokens: r.tokens,
    cents: r.cents,
  }));

  const total = buckets.reduce(
    (acc, b) => ({
      tokens:
        acc.tokens + b.inputTokens + b.outputTokens + b.cacheCreationTokens + b.cacheReadTokens,
      cents: acc.cents + b.costCents,
    }),
    { tokens: 0, cents: 0 },
  );

  return { buckets, byAgent, byProject, total };
};

const aggregateToday = (db: Database.Database, companyId: string): CostsAggregateTodayResult => {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = start + 86_400_000;
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) AS tokens,
         COALESCE(SUM(cost_cents_estimate), 0) AS cents
       FROM cost_events
       WHERE company_id = ? AND occurred_at >= ? AND occurred_at < ?`,
    )
    .get(companyId, start, end) as { tokens: number; cents: number };

  const byAgentRows = db
    .prepare(
      `SELECT cost_events.agent_id AS agent_id,
              COALESCE(agents.name, '(deleted)') AS agent_name,
              COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) AS tokens,
              COALESCE(SUM(cost_cents_estimate), 0) AS cents
       FROM cost_events
       LEFT JOIN agents ON agents.id = cost_events.agent_id
       WHERE cost_events.company_id = ? AND occurred_at >= ? AND occurred_at < ?
         AND cost_events.agent_id IS NOT NULL
       GROUP BY cost_events.agent_id, agents.name
       ORDER BY tokens DESC
       LIMIT 5`,
    )
    .all(companyId, start, end) as Array<{
    agent_id: string;
    agent_name: string;
    tokens: number;
    cents: number;
  }>;

  const budgets = createBudgetsRepository(db).read();
  const windowMs = budgets.rateLimitWindowHours * 3_600_000;
  const windowStart = Date.now() - windowMs;
  const windowRow = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
       FROM cost_events
       WHERE company_id = ? AND occurred_at >= ?`,
    )
    .get(companyId, windowStart) as { tokens: number };
  const percentMax =
    budgets.rateLimitWindowTokens > 0
      ? Math.min(100, Math.round((windowRow.tokens / budgets.rateLimitWindowTokens) * 100))
      : 0;

  return {
    totalCents: row.cents,
    totalTokens: row.tokens,
    percentMax,
    byAgent: byAgentRows.map((r) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      tokens: r.tokens,
      cents: r.cents,
    })),
  };
};

export const registerCostsHandlers = (db: Database.Database): void => {
  const budgetsRepo = createBudgetsRepository(db);
  const agentsRepo = createAgentsRepository(db);
  const costsRepo = createCostsRepository(db);

  ipcMain.handle(IPC.COSTS_QUERY, (_e, payload: CostsQueryInput): CostsQueryResult => {
    return queryCompany(db, payload);
  });

  ipcMain.handle(
    IPC.COSTS_AGGREGATE_TODAY,
    (_e, payload: { companyId: string }): CostsAggregateTodayResult => {
      return aggregateToday(db, payload.companyId);
    },
  );

  ipcMain.handle(IPC.COSTS_GET_BUDGETS, (): CostBudgets => budgetsRepo.read());

  ipcMain.handle(IPC.COSTS_SET_BUDGETS, (_e, payload: Partial<CostBudgets>): CostBudgets => {
    budgetsRepo.write(payload);
    return budgetsRepo.read();
  });

  ipcMain.handle(
    IPC.COSTS_GET_AGENT_BUDGET_STATUS,
    (_e, payload: { agentId: string }): AgentBudgetStatus => {
      const agent = agentsRepo.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      const total = costsRepo.getAgentPeriodTotal(payload.agentId, agent.budgetPeriod, new Date());
      return {
        period: agent.budgetPeriod,
        tokenTotal: total.tokens,
        tokenLimit: agent.budgetTokensLimit,
        usdTotalCents: total.cents,
        usdLimitCents: agent.budgetUsdLimit,
        adapterIsCostBearing: agent.adapterName.startsWith("claude-api-key"),
      };
    },
  );
};
