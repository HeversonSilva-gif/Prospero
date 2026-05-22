import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { ActivityEventRow, Agent } from "@prospero/shared";
import { applyMigrations } from "../db/migrations.js";
import { createRoutinesEngine } from "./engine.js";
import { createRoutinesRepository } from "./repository.js";

const setup = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    Date.now(),
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, model,
                         status, mode, always_on, capabilities_json,
                         created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'idle', 'supervised', 0, '[]', ?, ?)`,
  ).run("a1", "c1", "Bob", "engineer", "", "claude-sonnet-4-6", Date.now(), Date.now());
  return db;
};

const liveAgent = (): Agent => ({
  id: "a1",
  companyId: "c1",
  name: "Bob",
  role: "engineer",
  systemPrompt: "",
  model: "claude-sonnet-4-6",
  status: "idle",
  mode: "supervised",
  alwaysOn: false,
  capabilities: [],
  trustTier: "novato",
  autoModeSetAt: null,
  pauseReason: null,
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-cli",
  pausedAt: null,
  terminatedAt: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "monthly",
  canHire: false,
  canAssign: false,
});

describe("createRoutinesEngine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("onActivity fires matching event routines and records activity", () => {
    const db = setup();
    const repo = createRoutinesRepository(db);
    repo.create({
      companyId: "c1",
      name: "Watch goals",
      enabled: true,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "goal_achieved" },
      targetAgentId: "a1",
      instruction: "React to a goal",
    });

    const enqueue = vi.fn();
    const recordActivity = vi.fn();
    const engine = createRoutinesEngine({
      db,
      now: () => 1000,
      tickMs: 30_000,
      recordActivity,
    });
    engine.start({
      getAgent: () => liveAgent(),
      ensureAgentRunner: vi.fn(),
      enqueue,
      primaryThreadId: () => "t",
    });

    const row: ActivityEventRow = {
      id: "act_1",
      companyId: "c1",
      actorKind: "agent",
      actorId: "a1",
      action: "goal.status_changed",
      entityKind: "goal",
      entityId: "g1",
      agentId: "a1",
      payload: { to: "achieved" },
      createdAt: 1000,
    };
    engine.onActivity(row);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "routine.fired", payload: { reason: "event" } }),
    );
    engine.stop();
  });

  it("scheduler tick fires due schedule routines and advances next_fire_at past now", () => {
    const db = setup();
    const repo = createRoutinesRepository(db);
    const created = repo.create({
      companyId: "c1",
      name: "Standup",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "interval", everyMinutes: 5 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "Standup time",
    });

    const enqueue = vi.fn();
    const engine = createRoutinesEngine({
      db,
      now: () => 1_000_000,
      tickMs: 30_000,
      recordActivity: vi.fn(),
    });
    engine.start({
      getAgent: () => liveAgent(),
      ensureAgentRunner: vi.fn(),
      enqueue,
      primaryThreadId: () => "t",
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const after = repo.getById(created.id);
    expect(after?.nextFireAt).not.toBeNull();
    expect((after?.nextFireAt ?? 0) > 1_000_000).toBe(true);
    engine.stop();
  });

  it("runNow fires immediately with reason='manual'", () => {
    const db = setup();
    const repo = createRoutinesRepository(db);
    const created = repo.create({
      companyId: "c1",
      name: "M",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 999_999_999_999,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    const enqueue = vi.fn();
    const recordActivity = vi.fn();
    const engine = createRoutinesEngine({
      db,
      now: () => 0,
      tickMs: 30_000,
      recordActivity,
    });
    engine.start({
      getAgent: () => liveAgent(),
      ensureAgentRunner: vi.fn(),
      enqueue,
      primaryThreadId: () => "t",
    });
    engine.runNow(created.id);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "routine.fired", payload: { reason: "manual" } }),
    );
    engine.stop();
  });

  it("runNow throws when engine not started", () => {
    const db = setup();
    const repo = createRoutinesRepository(db);
    const created = repo.create({
      companyId: "c1",
      name: "M",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 999_999_999_999,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    const engine = createRoutinesEngine({
      db,
      now: () => 0,
      tickMs: 30_000,
      recordActivity: vi.fn(),
    });
    expect(() => engine.runNow(created.id)).toThrow(/not started/);
  });

  it("onActivity is a no-op before start (collects nothing)", () => {
    const db = setup();
    const recordActivity = vi.fn();
    const engine = createRoutinesEngine({
      db,
      now: () => 0,
      tickMs: 30_000,
      recordActivity,
    });
    engine.onActivity({
      id: "act",
      companyId: "c1",
      actorKind: "agent",
      actorId: "a1",
      action: "goal.status_changed",
      entityKind: "goal",
      entityId: "g1",
      agentId: "a1",
      payload: { to: "achieved" },
      createdAt: 1,
    });
    expect(recordActivity).not.toHaveBeenCalled();
  });
});
