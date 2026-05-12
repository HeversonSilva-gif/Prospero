import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createBudgetsRepository } from "../src/costs/budgets-repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return { db, repo: createBudgetsRepository(db) };
};

describe("budgets repository", () => {
  it("reads the seeded defaults from migration 0011", () => {
    const { repo } = setup();
    const b = repo.read();
    expect(b.maxTokensPerDayPerAgent).toBe(2_000_000);
    expect(b.maxTokensPerIssue).toBe(200_000);
    expect(b.rateLimitWindowTokens).toBe(1_000_000);
    expect(b.rateLimitWindowHours).toBe(5);
  });

  it("write merges partial input over existing values", () => {
    const { repo } = setup();
    repo.write({ maxTokensPerDayPerAgent: 500_000 });
    const b = repo.read();
    expect(b.maxTokensPerDayPerAgent).toBe(500_000);
    expect(b.maxTokensPerIssue).toBe(200_000);
  });

  it("rejects negative or non-integer values", () => {
    const { repo } = setup();
    expect(() => repo.write({ maxTokensPerDayPerAgent: -1 })).toThrow(/positive integer/i);
    expect(() => repo.write({ rateLimitWindowHours: 0 })).toThrow(/positive integer/i);
    expect(() => repo.write({ maxTokensPerIssue: 1.5 })).toThrow(/positive integer/i);
  });

  it("falls back to defaults if a key is missing or corrupt", () => {
    const { db, repo } = setup();
    db.prepare("DELETE FROM settings WHERE key = 'budget.max_tokens_per_issue'").run();
    db.prepare(
      "UPDATE settings SET value = 'not-a-number' WHERE key = 'budget.rate_limit_window_hours'",
    ).run();
    const b = repo.read();
    expect(b.maxTokensPerIssue).toBe(200_000);
    expect(b.rateLimitWindowHours).toBe(5);
  });

  it("resetDefaults overwrites every key to the canonical default", () => {
    const { repo } = setup();
    repo.write({ maxTokensPerDayPerAgent: 1, maxTokensPerIssue: 1 });
    repo.resetDefaults();
    expect(repo.read()).toEqual({
      maxTokensPerDayPerAgent: 2_000_000,
      maxTokensPerIssue: 200_000,
      rateLimitWindowTokens: 1_000_000,
      rateLimitWindowHours: 5,
    });
  });
});
