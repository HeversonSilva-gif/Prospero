import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createCostsRepository } from "../src/costs/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const agents = createAgentsRepository(db);
  const company = companies.create({ name: "Acme" });
  const agentX = agents.create({
    companyId: company.id,
    name: "X",
    role: "Engineer",
    systemPrompt: "",
    mode: "supervised",
    alwaysOn: false,
  });
  const agentY = agents.create({
    companyId: company.id,
    name: "Y",
    role: "Engineer",
    systemPrompt: "",
    mode: "supervised",
    alwaysOn: false,
  });
  const repo = createCostsRepository(db);
  return { db, companyId: company.id, agentXId: agentX.id, agentYId: agentY.id, repo };
};

describe("costs repository", () => {
  it("inserts a cost_event row and returns it", () => {
    const { repo, companyId, agentXId } = setup();
    const row = repo.insert({
      companyId,
      agentId: agentXId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: "sess_1",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 1,
      occurredAt: 1_700_000_000_000,
    });
    expect(row.id.startsWith("cost_")).toBe(true);
    expect(row.inputTokens).toBe(100);
    expect(row.costCentsEstimate).toBe(1);
  });

  it("getAgentDailyTotal sums tokens + cents for the given day (UTC)", () => {
    const { repo, companyId, agentXId } = setup();
    const day = new Date("2026-05-12T12:00:00Z");
    const sameDay = day.getTime();
    const nextDay = new Date("2026-05-13T01:00:00Z").getTime();
    repo.insert({
      companyId,
      agentId: agentXId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 5,
      occurredAt: sameDay,
    });
    repo.insert({
      companyId,
      agentId: agentXId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 50,
      outputTokens: 25,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 2,
      occurredAt: sameDay + 3600_000,
    });
    repo.insert({
      companyId,
      agentId: agentXId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 999,
      outputTokens: 999,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 50,
      occurredAt: nextDay,
    });
    const total = repo.getAgentDailyTotal(agentXId, day);
    expect(total.tokens).toBe(100 + 200 + 50 + 25);
    expect(total.cents).toBe(7);
  });

  it("getIssueTotal sums all rows tied to an issue across time", () => {
    const { db, repo, companyId, agentXId, agentYId } = setup();
    // create the issues we'll attach costs to (FK constraint)
    db.prepare(
      `INSERT INTO issues (id, company_id, title, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, 'todo', 'medium', 0, 0)`,
    ).run("iss_1", companyId, "issue 1");
    db.prepare(
      `INSERT INTO issues (id, company_id, title, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, 'todo', 'medium', 0, 0)`,
    ).run("iss_2", companyId, "issue 2");

    repo.insert({
      companyId,
      agentId: agentXId,
      projectId: null,
      issueId: "iss_1",
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 10,
      occurredAt: 1_700_000_000_000,
    });
    repo.insert({
      companyId,
      agentId: agentXId,
      projectId: null,
      issueId: "iss_1",
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 500,
      outputTokens: 250,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 5,
      occurredAt: 1_700_100_000_000,
    });
    repo.insert({
      companyId,
      agentId: agentYId,
      projectId: null,
      issueId: "iss_2",
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 9999,
      outputTokens: 9999,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 999,
      occurredAt: 1_700_200_000_000,
    });
    const total = repo.getIssueTotal("iss_1");
    expect(total.tokens).toBe(1000 + 500 + 500 + 250);
    expect(total.cents).toBe(15);
  });

  it("getAgentDailyTotal returns zeros for an agent with no rows", () => {
    const { repo } = setup();
    const total = repo.getAgentDailyTotal("agent_nobody", new Date());
    expect(total.tokens).toBe(0);
    expect(total.cents).toBe(0);
  });

  it("hasAgentRowsForDay returns true only when at least one row exists for that UTC day", () => {
    const { repo, companyId, agentXId } = setup();
    const day = new Date("2026-05-11T15:00:00Z");
    expect(repo.hasAgentRowsForDay(agentXId, day)).toBe(false);
    repo.insert({
      companyId,
      agentId: agentXId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 1,
      outputTokens: 1,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 1,
      occurredAt: day.getTime(),
    });
    expect(repo.hasAgentRowsForDay(agentXId, day)).toBe(true);
  });
});
