import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCostsRepository } from "./repository.js";
import { getCostBaseline } from "./baseline.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";

const setup = (
  templateId: string = "swe",
): {
  db: Database.Database;
  companyId: string;
  agentId: string;
  insertCost: (model: string, input: number, output: number) => void;
} => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createCompaniesRepository(db).create({ name: "Acme" });
  const agents = createAgentsRepository(db);
  const agent = agents.create({
    companyId: company.id,
    name: "Worker",
    role: templateId,
    systemPrompt: "You are a worker.",
    mode: "supervised",
    alwaysOn: true,
    model: "sonnet-4",
    templateId,
  });
  const costs = createCostsRepository(db);
  const insertCost = (model: string, input: number, output: number): void => {
    costs.insert({
      companyId: company.id,
      agentId: agent.id,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model,
      sessionId: null,
      inputTokens: input,
      outputTokens: output,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 0,
      occurredAt: Date.now(),
    });
  };
  return { db, companyId: company.id, agentId: agent.id, insertCost };
};

describe("getCostBaseline", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup("swe");
  });

  it("returns fallback when sample count below threshold", () => {
    env.insertCost("sonnet-4", 100, 50);
    const b = getCostBaseline(env.db, "swe", "sonnet-4");
    expect(b.fallbackUsed).toBe(true);
    expect(b.sampleCount).toBe(1);
    expect(b.avgInputTokens).toBe(2500);
    expect(b.avgOutputTokens).toBe(1200);
  });

  it("computes averages from cost_events when sample >= 5", () => {
    for (let i = 0; i < 5; i++) env.insertCost("sonnet-4", 1000, 500);
    const b = getCostBaseline(env.db, "swe", "sonnet-4");
    expect(b.fallbackUsed).toBe(false);
    expect(b.sampleCount).toBe(5);
    expect(b.avgInputTokens).toBe(1000);
    expect(b.avgOutputTokens).toBe(500);
  });

  it("uses sonnet-4 fallback for unknown model", () => {
    const b = getCostBaseline(env.db, "swe", "unknown-model");
    expect(b.fallbackUsed).toBe(true);
    expect(b.avgInputTokens).toBe(2500);
    expect(b.avgOutputTokens).toBe(1200);
  });

  it("filters by template_id (agents joined)", () => {
    for (let i = 0; i < 5; i++) env.insertCost("sonnet-4", 1000, 500);
    const b = getCostBaseline(env.db, "qa", "sonnet-4");
    expect(b.fallbackUsed).toBe(true);
    expect(b.sampleCount).toBe(0);
  });
});
