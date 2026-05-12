// Reads + writes the 4 budget.* keys seeded by migration 0011.
// Validation is strict: positive integers only. UI must show errors inline,
// not silently coerce — that's why we throw instead of clamping.

import type Database from "better-sqlite3";

export type CostBudgets = {
  maxTokensPerDayPerAgent: number;
  maxTokensPerIssue: number;
  rateLimitWindowTokens: number;
  rateLimitWindowHours: number;
};

export type BudgetsRepository = {
  read(): CostBudgets;
  write(patch: Partial<CostBudgets>): void;
  resetDefaults(): void;
};

const DEFAULTS: CostBudgets = {
  maxTokensPerDayPerAgent: 2_000_000,
  maxTokensPerIssue: 200_000,
  rateLimitWindowTokens: 1_000_000,
  rateLimitWindowHours: 5,
};

const KEY_MAP: Record<keyof CostBudgets, string> = {
  maxTokensPerDayPerAgent: "budget.max_tokens_per_day_per_agent",
  maxTokensPerIssue: "budget.max_tokens_per_issue",
  rateLimitWindowTokens: "budget.rate_limit_window_tokens",
  rateLimitWindowHours: "budget.rate_limit_window_hours",
};

const isPositiveInt = (v: number): boolean => Number.isInteger(v) && v > 0;

export const createBudgetsRepository = (db: Database.Database): BudgetsRepository => {
  const selectStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertStmt = db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  const readOne = (key: keyof CostBudgets): number => {
    const row = selectStmt.get(KEY_MAP[key]) as { value: string } | undefined;
    if (row === undefined) return DEFAULTS[key];
    const n = Number(row.value);
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : DEFAULTS[key];
  };

  const read = (): CostBudgets => ({
    maxTokensPerDayPerAgent: readOne("maxTokensPerDayPerAgent"),
    maxTokensPerIssue: readOne("maxTokensPerIssue"),
    rateLimitWindowTokens: readOne("rateLimitWindowTokens"),
    rateLimitWindowHours: readOne("rateLimitWindowHours"),
  });

  const write = (patch: Partial<CostBudgets>): void => {
    for (const key of Object.keys(patch) as (keyof CostBudgets)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      if (!isPositiveInt(value)) {
        throw new Error(`[budgets] ${key} must be a positive integer (got ${String(value)})`);
      }
      upsertStmt.run(KEY_MAP[key], String(value));
    }
  };

  const resetDefaults = (): void => {
    for (const key of Object.keys(DEFAULTS) as (keyof CostBudgets)[]) {
      upsertStmt.run(KEY_MAP[key], String(DEFAULTS[key]));
    }
  };

  return { read, write, resetDefaults };
};
