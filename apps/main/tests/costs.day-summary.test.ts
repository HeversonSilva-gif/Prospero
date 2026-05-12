import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { ActivityEventRow } from "@dashboard-agent/shared";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createCostsRepository } from "../src/costs/repository.js";
import { createRecorder as createActivityRecorder } from "../src/activity/recorder.js";
import { rollUpYesterdayIfNeeded } from "../src/costs/day-summary.js";

const YESTERDAY = new Date("2026-05-11T12:00:00Z").getTime();
const TODAY = new Date("2026-05-12T12:00:00Z").getTime();

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
  const activityRecorder = createActivityRecorder(db, vi.fn<(r: ActivityEventRow) => void>(), {
    devMode: false,
  });
  return { db, companyId: company.id, agentId: agent.id, costsRepo, activityRecorder };
};

describe("rollUpYesterdayIfNeeded", () => {
  it("emits cost.day_summary when agent has yesterday rows + no summary yet today", () => {
    const { db, companyId, agentId, costsRepo, activityRecorder } = setup();
    costsRepo.insert({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 2,
      occurredAt: YESTERDAY,
    });
    rollUpYesterdayIfNeeded({
      db,
      now: () => TODAY,
      companyId,
      agentId,
      costsRepo,
      activityRecorder,
    });
    const rows = db
      .prepare("SELECT payload_json FROM activity_events WHERE action = 'cost.day_summary'")
      .all() as Array<{ payload_json: string }>;
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]!.payload_json) as {
      inputTokens: number;
      outputTokens: number;
      totalUsd: number;
    };
    expect(payload.inputTokens).toBe(1000);
    expect(payload.outputTokens).toBe(500);
    expect(payload.totalUsd).toBeCloseTo(0.02, 2);
  });

  it("does NOT emit if agent has no rows yesterday", () => {
    const { db, companyId, agentId, costsRepo, activityRecorder } = setup();
    rollUpYesterdayIfNeeded({
      db,
      now: () => TODAY,
      companyId,
      agentId,
      costsRepo,
      activityRecorder,
    });
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM activity_events WHERE action = 'cost.day_summary'")
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("does NOT emit twice for the same day (idempotent within a day)", () => {
    const { db, companyId, agentId, costsRepo, activityRecorder } = setup();
    costsRepo.insert({
      companyId,
      agentId,
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
      occurredAt: YESTERDAY,
    });
    rollUpYesterdayIfNeeded({
      db,
      now: () => TODAY,
      companyId,
      agentId,
      costsRepo,
      activityRecorder,
    });
    rollUpYesterdayIfNeeded({
      db,
      now: () => TODAY,
      companyId,
      agentId,
      costsRepo,
      activityRecorder,
    });
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM activity_events WHERE action = 'cost.day_summary'")
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });
});
