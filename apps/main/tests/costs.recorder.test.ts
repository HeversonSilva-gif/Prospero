import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createCostsRepository } from "../src/costs/repository.js";
import { createCostRecorder } from "../src/costs/recorder.js";
import type { CostsBroadcast } from "../src/costs/recorder.js";

const setup = () => {
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
  const broadcast = vi.fn<CostsBroadcast>();
  const recorder = createCostRecorder({
    costsRepo,
    broadcast,
    now: () => 1_700_000_000_000,
  });
  return { db, companyId: company.id, agentId: agent.id, costsRepo, broadcast, recorder };
};

describe("createCostRecorder.recordTurn", () => {
  it("inserts a row with computed cost cents", () => {
    const { recorder, companyId, agentId, db } = setup();
    const out = recorder.recordTurn({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: "sess_1",
      usage: { input: 1_000_000, output: 0, cache_creation: 0, cache_read: 0 },
    });
    expect(out.eventId.startsWith("cost_")).toBe(true);
    expect(out.costCents).toBe(300);
    const count = db.prepare("SELECT COUNT(*) AS n FROM cost_events").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("labels the cost row with the agent's adapter (remote docker)", () => {
    const { recorder, companyId, agentId, db } = setup();
    recorder.recordTurn({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-remote-docker",
      model: "claude-sonnet-4-6",
      sessionId: null,
      usage: { input: 100, output: 50, cache_creation: 0, cache_read: 0 },
    });
    const row = db.prepare("SELECT adapter_name FROM cost_events").get() as {
      adapter_name: string;
    };
    expect(row.adapter_name).toBe("claude-oauth-remote-docker");
  });

  it("returns 0 cost when model is unknown but still persists tokens", () => {
    const { recorder, companyId, agentId, db } = setup();
    const out = recorder.recordTurn({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "future-model-not-mapped",
      sessionId: null,
      usage: { input: 1000, output: 500, cache_creation: 0, cache_read: 0 },
    });
    expect(out.costCents).toBe(0);
    const row = db.prepare("SELECT input_tokens, output_tokens FROM cost_events").get() as {
      input_tokens: number;
      output_tokens: number;
    };
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(500);
  });

  it("broadcasts a delta payload on insert", () => {
    const { recorder, broadcast, companyId, agentId } = setup();
    recorder.recordTurn({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      usage: { input: 1000, output: 500, cache_creation: 0, cache_read: 0 },
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    const arg = broadcast.mock.calls[0]?.[0];
    expect(arg?.agentId).toBe(agentId);
    expect(arg?.deltaTokens).toBe(1500);
    expect(typeof arg?.deltaCents).toBe("number");
  });

  it("skips persistence when usage is zero (defensive)", () => {
    const { recorder, broadcast, db, companyId, agentId } = setup();
    const out = recorder.recordTurn({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      usage: { input: 0, output: 0, cache_creation: 0, cache_read: 0 },
    });
    expect(out.eventId).toBe("");
    expect(out.costCents).toBe(0);
    const count = db.prepare("SELECT COUNT(*) AS n FROM cost_events").get() as { n: number };
    expect(count.n).toBe(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
