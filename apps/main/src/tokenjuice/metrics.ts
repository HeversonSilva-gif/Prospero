import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CompressStats } from "./index.js";

// Minimal structural context — avoids importing ToolContext from mcp/ (which
// would create a backwards dependency). The MCP ctx satisfies this shape.
export interface MetricsContext {
  db: Database.Database;
  companyId: string;
  agentId: string;
}

export interface ToolOutputMetricInsert {
  companyId: string;
  agentId: string;
  toolName: string;
  rawChars: number;
  reducedChars: number;
  estTokensSaved: number;
  mode: string;
  clamped: boolean;
  createdAt: number;
}

export const createToolOutputMetricsRepository = (db: Database.Database) => {
  const insertStmt = db.prepare(`
    INSERT INTO tool_output_metrics (
      id, company_id, agent_id, tool_name, raw_chars, reduced_chars,
      est_tokens_saved, mode, clamped, created_at
    ) VALUES (
      @id, @companyId, @agentId, @toolName, @rawChars, @reducedChars,
      @estTokensSaved, @mode, @clampedInt, @createdAt
    )
  `);
  const insert = (input: ToolOutputMetricInsert): { id: string } => {
    const id = `tom_${randomUUID()}`;
    insertStmt.run({
      id,
      companyId: input.companyId,
      agentId: input.agentId,
      toolName: input.toolName,
      rawChars: input.rawChars,
      reducedChars: input.reducedChars,
      estTokensSaved: input.estTokensSaved,
      mode: input.mode,
      clampedInt: input.clamped ? 1 : 0,
      createdAt: input.createdAt,
    });
    return { id };
  };
  return { insert };
};

const repoCache = new WeakMap<
  Database.Database,
  ReturnType<typeof createToolOutputMetricsRepository>
>();

const repoFor = (db: Database.Database): ReturnType<typeof createToolOutputMetricsRepository> => {
  let repo = repoCache.get(db);
  if (repo === undefined) {
    repo = createToolOutputMetricsRepository(db);
    repoCache.set(db, repo);
  }
  return repo;
};

export const recordToolOutputMetrics = (ctx: MetricsContext, stats: CompressStats): void => {
  try {
    repoFor(ctx.db).insert({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      toolName: stats.toolName,
      rawChars: stats.rawChars,
      reducedChars: stats.reducedChars,
      estTokensSaved: stats.estTokensSaved,
      mode: stats.mode,
      clamped: stats.clamped,
      createdAt: Date.now(),
    });
  } catch (err) {
    // Metrics must never break the tool path.
    console.warn("[tokenjuice] metrics insert failed", err);
  }
};
