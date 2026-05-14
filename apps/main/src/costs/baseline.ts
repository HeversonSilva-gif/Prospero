import type Database from "better-sqlite3";

export type CostBaseline = {
  avgInputTokens: number;
  avgOutputTokens: number;
  sampleCount: number;
  fallbackUsed: boolean;
};

const MIN_SAMPLE = 5;

const FALLBACK: Record<string, { input: number; output: number }> = {
  "opus-4": { input: 3000, output: 1500 },
  "sonnet-4": { input: 2500, output: 1200 },
  "haiku-4": { input: 1500, output: 800 },
  "opus-4-thinking": { input: 3500, output: 2000 },
  "sonnet-4-thinking": { input: 3000, output: 1600 },
};

const fallbackFor = (model: string): { input: number; output: number } =>
  FALLBACK[model] ?? FALLBACK["sonnet-4"]!;

export const getCostBaseline = (
  db: Database.Database,
  templateId: string,
  model: string,
): CostBaseline => {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS sample_count,
         COALESCE(AVG(c.input_tokens), 0) AS avg_input,
         COALESCE(AVG(c.output_tokens), 0) AS avg_output
       FROM cost_events c
       JOIN agents a ON a.id = c.agent_id
       WHERE a.template_id = ? AND c.model = ?`,
    )
    .get(templateId, model) as {
    sample_count: number;
    avg_input: number;
    avg_output: number;
  };

  if (row.sample_count >= MIN_SAMPLE) {
    return {
      avgInputTokens: Math.round(row.avg_input),
      avgOutputTokens: Math.round(row.avg_output),
      sampleCount: row.sample_count,
      fallbackUsed: false,
    };
  }
  const fb = fallbackFor(model);
  return {
    avgInputTokens: fb.input,
    avgOutputTokens: fb.output,
    sampleCount: row.sample_count,
    fallbackUsed: true,
  };
};
