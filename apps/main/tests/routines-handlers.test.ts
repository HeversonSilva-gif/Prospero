import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Agent } from "@prospero/shared";
import { applyMigrations } from "../src/db/migrations.js";
import { routinesHandlers } from "../src/ipc/routines-handlers.js";
import { _setRecorderForTest } from "../src/activity/index.js";
import { _setRoutinesEngineForTest } from "../src/routines/index.js";
import { createRoutinesEngine } from "../src/routines/engine.js";

const seed = (): Database.Database => {
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

const liveAgent = (): Agent =>
  ({
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
  }) as unknown as Agent;

describe("routinesHandlers", () => {
  let db: Database.Database;
  const recordActivity = vi.fn();
  beforeEach(() => {
    db = seed();
    recordActivity.mockReset();
    _setRecorderForTest({
      recordActivity: (input) => {
        recordActivity(input);
        return {} as never;
      },
    });
    const engine = createRoutinesEngine({
      db,
      now: () => 1_000_000,
      tickMs: 30_000,
      recordActivity: (input) => {
        recordActivity(input);
      },
    });
    engine.start({
      getAgent: () => liveAgent(),
      ensureAgentRunner: vi.fn(),
      enqueue: vi.fn(),
      primaryThreadId: () => "t",
    });
    _setRoutinesEngineForTest(engine);
  });
  afterEach(() => {
    _setRoutinesEngineForTest(null);
    _setRecorderForTest(null);
  });

  it("create + list — round-trips a schedule routine", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "Standup",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "Run standup",
      },
    });
    expect(created.id).toMatch(/^routine_/);
    expect(created.nextFireAt).not.toBeNull();
    const list = h.list({ companyId: "c1" });
    expect(list).toHaveLength(1);
  });

  it("create — rejects invalid input via zod", () => {
    const h = routinesHandlers({ db });
    expect(() =>
      h.create({
        input: {
          companyId: "c1",
          name: "",
          enabled: true,
          triggerType: "schedule",
          scheduleSpec: { freq: "daily", atMinute: 540 },
          targetAgentId: "a1",
          instruction: "x",
        } as never,
      }),
    ).toThrow();
  });

  it("update — patches enabled", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "X",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "x",
      },
    });
    const updated = h.update({ input: { id: created.id, enabled: false } });
    expect(updated.enabled).toBe(false);
  });

  it("delete — removes the row", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "X",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "x",
      },
    });
    h.delete({ id: created.id });
    expect(h.list({ companyId: "c1" })).toHaveLength(0);
  });

  it("runNow — records routine.fired with reason='manual'", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "X",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "x",
      },
    });
    recordActivity.mockReset();
    h.runNow({ id: created.id });
    const fired = recordActivity.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (c) => c[0].action === "routine.fired",
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(fired?.[0].payload.reason).toBe("manual");
  });

  it("update — re-seeds nextFireAt when scheduleSpec changes", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "Standup",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "x",
      },
    });
    const initialNextFire = created.nextFireAt;
    expect(initialNextFire).not.toBeNull();

    const updated = h.update({
      input: {
        id: created.id,
        scheduleSpec: { freq: "daily", atMinute: 600 },
      },
    });

    expect(updated.nextFireAt).not.toBeNull();
    expect(updated.nextFireAt).not.toBe(initialNextFire);
  });
});
