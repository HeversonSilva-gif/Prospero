// Read/write surface for the cost_events table.
// All time math is UTC (midnight-to-midnight on the calendar day in UTC).
// The day boundary matches what the user sees in /costs charts; renderer
// localizes display but bucketing stays canonical.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AgentRunRow, BudgetPeriod } from "@prospero/shared";
import { utcMonthBounds } from "./period.js";

export type CostEventInsert = {
  companyId: string;
  agentId: string | null;
  projectId: string | null;
  issueId: string | null;
  adapterName: string;
  model: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costCentsEstimate: number;
  occurredAt: number;
};

export type CostEventRow = CostEventInsert & { id: string };

export type CostTotal = { tokens: number; cents: number };

export type CostsRepository = {
  insert(input: CostEventInsert): CostEventRow;
  getAgentDailyTotal(agentId: string, day: Date): CostTotal;
  getIssueTotal(issueId: string): CostTotal;
  hasAgentRowsForDay(agentId: string, day: Date): boolean;
  listRunsByAgent(agentId: string, limit?: number): AgentRunRow[];
  getAgentPeriodTotal(agentId: string, period: BudgetPeriod, now: Date): CostTotal;
};

const utcDayBounds = (day: Date): { start: number; end: number } => {
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return { start, end: start + 86_400_000 };
};

const totalTokens = (row: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}): number =>
  row.input_tokens + row.output_tokens + row.cache_creation_tokens + row.cache_read_tokens;

export const createCostsRepository = (db: Database.Database): CostsRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO cost_events (
      id, company_id, agent_id, project_id, issue_id, adapter_name, model, session_id,
      input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
      cost_cents_estimate, occurred_at
    ) VALUES (
      @id, @companyId, @agentId, @projectId, @issueId, @adapterName, @model, @sessionId,
      @inputTokens, @outputTokens, @cacheCreationTokens, @cacheReadTokens,
      @costCentsEstimate, @occurredAt
    )
  `);

  const sumAgentDayStmt = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cost_cents_estimate), 0) AS cost_cents_estimate
    FROM cost_events
    WHERE agent_id = ? AND occurred_at >= ? AND occurred_at < ?
  `);

  const sumIssueStmt = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cost_cents_estimate), 0) AS cost_cents_estimate
    FROM cost_events
    WHERE issue_id = ?
  `);

  const hasAgentDayStmt = db.prepare(`
    SELECT 1 AS hit
    FROM cost_events
    WHERE agent_id = ? AND occurred_at >= ? AND occurred_at < ?
    LIMIT 1
  `);

  const listRunsStmt = db.prepare(`
    SELECT id, agent_id, occurred_at, model, adapter_name,
           input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
           cost_cents_estimate, issue_id, session_id
    FROM cost_events
    WHERE agent_id = ?
    ORDER BY occurred_at DESC, id DESC
    LIMIT ?
  `);

  const insert = (input: CostEventInsert): CostEventRow => {
    const id = `cost_${randomUUID()}`;
    insertStmt.run({ id, ...input });
    return { id, ...input };
  };

  const getAgentDailyTotal = (agentId: string, day: Date): CostTotal => {
    const { start, end } = utcDayBounds(day);
    const row = sumAgentDayStmt.get(agentId, start, end) as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_cents_estimate: number;
    };
    return { tokens: totalTokens(row), cents: row.cost_cents_estimate };
  };

  const getIssueTotal = (issueId: string): CostTotal => {
    const row = sumIssueStmt.get(issueId) as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_cents_estimate: number;
    };
    return { tokens: totalTokens(row), cents: row.cost_cents_estimate };
  };

  const hasAgentRowsForDay = (agentId: string, day: Date): boolean => {
    const { start, end } = utcDayBounds(day);
    const row = hasAgentDayStmt.get(agentId, start, end) as { hit: number } | undefined;
    return row !== undefined;
  };

  const listRunsByAgent = (agentId: string, limit?: number): AgentRunRow[] => {
    const cap = Math.max(1, Math.min(500, limit ?? 100));
    const rows = listRunsStmt.all(agentId, cap) as Array<{
      id: string;
      agent_id: string;
      occurred_at: number;
      model: string | null;
      adapter_name: string;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_cents_estimate: number;
      issue_id: string | null;
      session_id: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      occurredAt: r.occurred_at,
      model: r.model,
      adapterName: r.adapter_name,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheCreationTokens: r.cache_creation_tokens,
      cacheReadTokens: r.cache_read_tokens,
      costCentsEstimate: r.cost_cents_estimate,
      issueId: r.issue_id,
      sessionId: r.session_id,
    }));
  };

  const getAgentPeriodTotal = (agentId: string, period: BudgetPeriod, now: Date): CostTotal => {
    const { start, end } = period === "monthly" ? utcMonthBounds(now) : utcDayBounds(now);
    const row = sumAgentDayStmt.get(agentId, start, end) as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_cents_estimate: number;
    };
    return { tokens: totalTokens(row), cents: row.cost_cents_estimate };
  };

  return {
    insert,
    getAgentDailyTotal,
    getIssueTotal,
    hasAgentRowsForDay,
    listRunsByAgent,
    getAgentPeriodTotal,
  };
};
