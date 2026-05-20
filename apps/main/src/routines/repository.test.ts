import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
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

describe("RoutinesRepository", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setup();
  });

  it("create — round-trips a schedule routine", () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "Standup",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 1000,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "Run standup",
    });
    expect(r.id).toMatch(/^routine_/);
    expect(r.scheduleSpec).toEqual({ freq: "daily", atMinute: 540 });
    expect(r.nextFireAt).toBe(1000);
    expect(r.lastFiredAt).toBeNull();
  });

  it("create — round-trips an event routine", () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "Watch goals",
      enabled: true,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "goal_achieved" },
      targetAgentId: "a1",
      instruction: "React",
    });
    expect(r.eventSpec).toEqual({ eventType: "goal_achieved" });
    expect(r.scheduleSpec).toBeNull();
    expect(r.nextFireAt).toBeNull();
  });

  it("listByCompany — returns most-recently-updated first", () => {
    const repo = createRoutinesRepository(db);
    repo.create({
      companyId: "c1",
      name: "A",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "B",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 600 },
      nextFireAt: 200,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "y",
    });
    const list = repo.listByCompany("c1");
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe("B");
  });

  it("listDueSchedule — only enabled, schedule, next_fire_at <= now", () => {
    const repo = createRoutinesRepository(db);
    const due = repo.create({
      companyId: "c1",
      name: "Due",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "Future",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 10_000,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "Disabled",
      enabled: false,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "Event",
      enabled: true,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "goal_achieved" },
      targetAgentId: "a1",
      instruction: "x",
    });
    const dueList = repo.listDueSchedule(500);
    expect(dueList.map((r) => r.id)).toEqual([due.id]);
  });

  it("listEnabledEvent — only enabled event routines", () => {
    const repo = createRoutinesRepository(db);
    repo.create({
      companyId: "c1",
      name: "S",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    const ev = repo.create({
      companyId: "c1",
      name: "E",
      enabled: true,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "issue_done" },
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "Edis",
      enabled: false,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "issue_done" },
      targetAgentId: "a1",
      instruction: "x",
    });
    const list = repo.listEnabledEvent();
    expect(list.map((r) => r.id)).toEqual([ev.id]);
  });

  it("update — patches only provided fields and bumps updated_at", async () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "Old",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    await new Promise((res) => setTimeout(res, 5));
    repo.update({ id: r.id, name: "New", enabled: false });
    const updated = repo.getById(r.id);
    expect(updated?.name).toBe("New");
    expect(updated?.enabled).toBe(false);
    expect(updated?.instruction).toBe("x");
    expect((updated?.updatedAt ?? 0) > r.updatedAt).toBe(true);
  });

  it("delete — removes the row", () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "X",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.delete(r.id);
    expect(repo.getById(r.id)).toBeNull();
  });

  it("setNextFireAt + setLastFiredAt — write through and read back", () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "X",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.setNextFireAt(r.id, 2000);
    repo.setLastFiredAt(r.id, 1500);
    const got = repo.getById(r.id);
    expect(got?.nextFireAt).toBe(2000);
    expect(got?.lastFiredAt).toBe(1500);
  });
});
