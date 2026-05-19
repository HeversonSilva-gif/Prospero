import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createCostsRepository } from "../src/costs/repository.js";
import { registerCostsHandlers } from "../src/ipc/costs-handlers.js";

type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
  },
}));

const setup = () => {
  handlers.clear();
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const agents = createAgentsRepository(db);
  const company = companies.create({ name: "Acme" });
  const agent = agents.create({
    companyId: company.id,
    name: "X",
    role: "Engineer",
    systemPrompt: "",
    mode: "supervised",
    alwaysOn: false,
  });
  const costsRepo = createCostsRepository(db);
  registerCostsHandlers(db);
  return { db, companyId: company.id, agentId: agent.id, costsRepo };
};

describe("costs IPC handlers", () => {
  it("costs:query returns total over the requested range", () => {
    const { companyId, agentId, costsRepo } = setup();
    costsRepo.insert({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 3,
      occurredAt: Date.UTC(2026, 4, 12, 10),
    });
    const handler = handlers.get("costs:query")!;
    const result = handler(null, {
      companyId,
      scope: "company",
      from: Date.UTC(2026, 4, 12),
      to: Date.UTC(2026, 4, 13),
      bucket: "day",
    }) as { total: { tokens: number; cents: number }; buckets: unknown[] };
    expect(result.total.tokens).toBe(150);
    expect(result.total.cents).toBe(3);
    expect(result.buckets).toHaveLength(1);
  });

  it("costs:aggregate-today returns 0 when no rows exist for today", () => {
    const { companyId } = setup();
    const handler = handlers.get("costs:aggregate-today")!;
    const result = handler(null, { companyId }) as {
      totalCents: number;
      totalTokens: number;
    };
    expect(result.totalCents).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it("costs:get-budgets returns the seeded defaults", () => {
    setup();
    const handler = handlers.get("costs:get-budgets")!;
    const result = handler(null, {}) as { maxTokensPerDayPerAgent: number };
    expect(result.maxTokensPerDayPerAgent).toBe(2_000_000);
  });

  it("costs:set-budgets updates a subset and returns the merged set", () => {
    setup();
    const setHandler = handlers.get("costs:set-budgets")!;
    const updated = setHandler(null, { maxTokensPerIssue: 100_000 }) as {
      maxTokensPerIssue: number;
      maxTokensPerDayPerAgent: number;
    };
    expect(updated.maxTokensPerIssue).toBe(100_000);
    expect(updated.maxTokensPerDayPerAgent).toBe(2_000_000);
  });

  it("costs:set-budgets rejects invalid input", () => {
    setup();
    const setHandler = handlers.get("costs:set-budgets")!;
    expect(() => setHandler(null, { maxTokensPerIssue: -1 })).toThrow(/positive integer/i);
  });

  it("costs:get-agent-budget-status reflects the agent's period total", () => {
    const { db, companyId, agentId, costsRepo } = setup();
    const agents = createAgentsRepository(db);
    agents.setBudget(agentId, { tokensLimit: 1000, usdLimit: 500, period: "daily" });
    costsRepo.insert({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      inputTokens: 300,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 12,
      occurredAt: Date.now(),
    });
    const handler = handlers.get("costs:get-agent-budget-status")!;
    const result = handler(null, { agentId }) as {
      period: string;
      tokenTotal: number;
      tokenLimit: number | null;
      usdTotalCents: number;
      usdLimitCents: number | null;
      adapterIsCostBearing: boolean;
    };
    expect(result.period).toBe("daily");
    expect(result.tokenTotal).toBe(300);
    expect(result.tokenLimit).toBe(1000);
    expect(result.usdTotalCents).toBe(12);
    expect(result.usdLimitCents).toBe(500);
    expect(result.adapterIsCostBearing).toBe(false);
  });
});
