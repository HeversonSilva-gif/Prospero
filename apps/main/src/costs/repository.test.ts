import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createCostsRepository, type CostEventInsert } from "./repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

const makeAgent = (db: Database.Database, companyId: string, name: string): string =>
  createAgentsRepository(db).create({
    companyId,
    name,
    role: "role-engineer",
    systemPrompt: "",
    mode: "supervised",
    alwaysOn: false,
    templateId: "role-engineer",
    actor: { kind: "user" },
  }).id;

const turn = (over: Partial<CostEventInsert>): CostEventInsert => ({
  companyId: "",
  agentId: null,
  projectId: null,
  issueId: null,
  adapterName: "claude-oauth-local",
  model: "claude-sonnet-4-6",
  sessionId: "sess-1",
  inputTokens: 10,
  outputTokens: 5,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costCentsEstimate: 3,
  occurredAt: 1000,
  ...over,
});

describe("createCostsRepository.listRunsByAgent", () => {
  it("returns the agent's runs newest-first", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "Alice");
    const repo = createCostsRepository(db);
    repo.insert(turn({ companyId: co.id, agentId, occurredAt: 1000 }));
    repo.insert(turn({ companyId: co.id, agentId, occurredAt: 3000 }));
    repo.insert(turn({ companyId: co.id, agentId, occurredAt: 2000 }));

    const runs = repo.listRunsByAgent(agentId);

    expect(runs.map((r) => r.occurredAt)).toEqual([3000, 2000, 1000]);
    expect(runs[0]!.inputTokens).toBe(10);
    expect(runs[0]!.adapterName).toBe("claude-oauth-local");
    expect(runs[0]!.sessionId).toBe("sess-1");
  });

  it("honors the limit argument", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "Alice");
    const repo = createCostsRepository(db);
    for (let i = 0; i < 5; i++) repo.insert(turn({ companyId: co.id, agentId, occurredAt: i }));

    expect(repo.listRunsByAgent(agentId, 2)).toHaveLength(2);
  });

  it("returns only the requested agent's runs", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const a = makeAgent(db, co.id, "Alice");
    const b = makeAgent(db, co.id, "Bob");
    const repo = createCostsRepository(db);
    repo.insert(turn({ companyId: co.id, agentId: a, occurredAt: 1 }));
    repo.insert(turn({ companyId: co.id, agentId: b, occurredAt: 2 }));

    const runs = repo.listRunsByAgent(a);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.agentId).toBe(a);
  });

  it("clamps the limit to the [1, 500] range", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "Alice");
    const repo = createCostsRepository(db);
    for (let i = 0; i < 3; i++) repo.insert(turn({ companyId: co.id, agentId, occurredAt: i }));

    // limit 0 clamps up to 1 — never returns zero rows for a bad input
    expect(repo.listRunsByAgent(agentId, 0)).toHaveLength(1);
    // limit far above 500 still returns all available rows, not an error
    expect(repo.listRunsByAgent(agentId, 9999)).toHaveLength(3);
  });
});

describe("getAgentPeriodTotal", () => {
  it("sums daily and monthly windows for an agent", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "Alice");
    const repo = createCostsRepository(db);

    const insertAt = (occurredAt: number): void => {
      repo.insert({
        companyId: co.id,
        agentId,
        projectId: null,
        issueId: null,
        adapterName: "claude-api-key-local",
        model: "claude-sonnet-4-6",
        sessionId: null,
        inputTokens: 100,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        costCentsEstimate: 7,
        occurredAt,
      });
    };

    insertAt(Date.UTC(2026, 4, 18, 9)); // in-day + in-month
    insertAt(Date.UTC(2026, 4, 3, 9)); // earlier same month, not same day

    const now = new Date(Date.UTC(2026, 4, 18, 12));
    expect(repo.getAgentPeriodTotal(agentId, "daily", now)).toEqual({
      tokens: 100,
      billableTokens: 100,
      cents: 7,
    });
    expect(repo.getAgentPeriodTotal(agentId, "monthly", now)).toEqual({
      tokens: 200,
      billableTokens: 200,
      cents: 14,
    });
  });
});

describe("getAgentDailyTotal / getIssueTotal — billableTokens excludes cache_read", () => {
  it("includes cache_read in tokens but not billableTokens for daily total", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "CEO");
    const repo = createCostsRepository(db);

    const now = new Date(Date.UTC(2026, 4, 18, 10));
    repo.insert(
      turn({
        companyId: co.id,
        agentId,
        inputTokens: 1_000,
        outputTokens: 500,
        cacheCreationTokens: 2_000,
        cacheReadTokens: 629_000, // large cache_read, as the CEO produces
        occurredAt: Date.UTC(2026, 4, 18, 9),
      }),
    );

    const daily = repo.getAgentDailyTotal(agentId, now);
    // tokens = all four columns summed
    expect(daily.tokens).toBe(1_000 + 500 + 2_000 + 629_000);
    // billableTokens = input + output + cache_creation only (excludes cache_read)
    expect(daily.billableTokens).toBe(1_000 + 500 + 2_000);
    expect(daily.cents).toBeGreaterThan(0);
  });

  it("includes cache_read in tokens but not billableTokens for issue total", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "CEO");
    const repo = createCostsRepository(db);

    // insert the issue row so the FK constraint is satisfied
    const issueId = "iss_ceo_cache_test";
    db.prepare(
      `INSERT INTO issues (id, company_id, title, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, 'todo', 'medium', 0, 0)`,
    ).run(issueId, co.id, "CEO cache test issue");

    repo.insert(
      turn({
        companyId: co.id,
        agentId,
        issueId,
        inputTokens: 500,
        outputTokens: 200,
        cacheCreationTokens: 1_000,
        cacheReadTokens: 400_000,
        occurredAt: Date.UTC(2026, 4, 18, 9),
      }),
    );

    const issueTotal = repo.getIssueTotal(issueId);
    expect(issueTotal.tokens).toBe(500 + 200 + 1_000 + 400_000);
    expect(issueTotal.billableTokens).toBe(500 + 200 + 1_000);
  });
});

describe("getCompanyTotalSince", () => {
  it("sums the company's cost_cents over the window, excluding others/older", () => {
    const db = setupDb();
    const c1 = createCompaniesRepository(db).create({ name: "A" }).id;
    const c2 = createCompaniesRepository(db).create({ name: "B" }).id;
    const a1 = makeAgent(db, c1, "Alice");
    const a2 = makeAgent(db, c2, "Bob");
    const repo = createCostsRepository(db);
    repo.insert(turn({ companyId: c1, agentId: a1, costCentsEstimate: 120, occurredAt: 10_000 }));
    repo.insert(turn({ companyId: c1, agentId: a1, costCentsEstimate: 80, occurredAt: 5_000 }));
    repo.insert(turn({ companyId: c1, agentId: a1, costCentsEstimate: 999, occurredAt: 1_000 })); // before window
    repo.insert(turn({ companyId: c2, agentId: a2, costCentsEstimate: 500, occurredAt: 10_000 })); // other company
    expect(repo.getCompanyTotalSince(c1, 4_000).cents).toBe(200);
    expect(repo.getCompanyTotalSince("nope", 0).cents).toBe(0);
  });
});
