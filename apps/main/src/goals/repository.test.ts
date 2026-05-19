import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createGoalsRepository } from "./repository.js";
import { createCompaniesRepository } from "../companies/repository.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
};

const seedCompany = (db: Database.Database): string => {
  const repo = createCompaniesRepository(db);
  return repo.create({ name: "Acme" }).id;
};

describe("goalsRepository", () => {
  let db: Database.Database;
  let companyId: string;
  beforeEach(() => {
    db = newDb();
    companyId = seedCompany(db);
  });

  it("creates a goal with defaults", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "Ship M8.5" });
    expect(goal.id).toMatch(/^goal_/);
    expect(goal.status).toBe("draft");
    expect(goal.level).toBe("task");
    expect(goal.parentGoalId).toBeNull();
  });

  it("retrieves by id", () => {
    const repo = createGoalsRepository(db);
    const created = repo.create({ companyId, title: "Ship M8.5" });
    const fetched = repo.getById(created.id);
    expect(fetched?.title).toBe("Ship M8.5");
  });

  it("returns null for missing id", () => {
    const repo = createGoalsRepository(db);
    expect(repo.getById("goal_nonexistent")).toBeNull();
  });

  it("lists by company", () => {
    const repo = createGoalsRepository(db);
    repo.create({ companyId, title: "A" });
    repo.create({ companyId, title: "B" });
    expect(repo.listByCompany(companyId)).toHaveLength(2);
  });

  it("filters list by status", () => {
    const repo = createGoalsRepository(db);
    const a = repo.create({ companyId, title: "A" });
    repo.create({ companyId, title: "B" });
    repo.updateStatus(a.id, "planning");
    const planning = repo.listByCompany(companyId, { status: "planning" });
    expect(planning).toHaveLength(1);
    expect(planning[0]?.title).toBe("A");
  });

  it("updates status with valid transition", () => {
    const repo = createGoalsRepository(db);
    const g = repo.create({ companyId, title: "X" });
    const updated = repo.updateStatus(g.id, "planning");
    expect(updated.status).toBe("planning");
    expect(updated.updatedAt).toBeGreaterThanOrEqual(g.updatedAt);
  });

  it("throws on invalid transition (draft → in_progress)", () => {
    const repo = createGoalsRepository(db);
    const g = repo.create({ companyId, title: "X" });
    expect(() => repo.updateStatus(g.id, "in_progress")).toThrow(/invalid transition/i);
  });

  it("accepts transition draft → cancelled (user can cancel any time)", () => {
    const repo = createGoalsRepository(db);
    const g = repo.create({ companyId, title: "X" });
    const updated = repo.updateStatus(g.id, "cancelled");
    expect(updated.status).toBe("cancelled");
  });

  it("create returns isaPath as null by default", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "Launch" });
    expect(goal.isaPath).toBeNull();
  });

  it("setIsaPath persists the relative isa path", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "Launch" });
    repo.setIsaPath(goal.id, "companies/c/goals/g/isa.md");
    expect(repo.getById(goal.id)?.isaPath).toBe("companies/c/goals/g/isa.md");
  });

  it("allows in_progress -> verifying -> achieved", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "Launch" });
    repo.updateStatus(goal.id, "planning");
    repo.updateStatus(goal.id, "proposed");
    repo.updateStatus(goal.id, "approved");
    repo.updateStatus(goal.id, "in_progress");
    repo.updateStatus(goal.id, "verifying");
    repo.updateStatus(goal.id, "achieved");
    expect(repo.getById(goal.id)?.status).toBe("achieved");
  });

  it("allows verifying -> in_progress (verification bounce-back)", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "Launch" });
    repo.updateStatus(goal.id, "planning");
    repo.updateStatus(goal.id, "proposed");
    repo.updateStatus(goal.id, "approved");
    repo.updateStatus(goal.id, "in_progress");
    repo.updateStatus(goal.id, "verifying");
    repo.updateStatus(goal.id, "in_progress");
    expect(repo.getById(goal.id)?.status).toBe("in_progress");
  });
});

describe("goalsRepository — narrated execution state", () => {
  let db: Database.Database;
  let companyId: string;
  let ceoId: string;

  beforeEach(async () => {
    db = newDb();
    companyId = seedCompany(db);
    const { createAgentsRepository } = await import("../agents/repository.js");
    const ceo = createAgentsRepository(db).create({
      companyId,
      name: "CEO",
      role: "ceo",
      systemPrompt: "x",
      mode: "supervised",
      alwaysOn: true,
      model: "claude-opus-4-7",
      templateId: "ceo",
    });
    ceoId = ceo.id;
  });

  const mkState = (overrides: Partial<{ ceoId: string; planId: string }> = {}) => ({
    planId: overrides.planId ?? "p_x",
    mode: "narrated" as const,
    includeAgentIndexes: null,
    includeIssueIndexes: null,
    agentIndexToId: {} as Record<number, string>,
    issueIndexToId: {} as Record<number, string>,
    step: "starting" as const,
    startedAt: 1,
    ceoId: overrides.ceoId ?? ceoId,
    threadId: "th_x",
  });

  it("setExecutionState writes JSON and getExecutionState reads it back", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "G" });
    const state = mkState();
    repo.setExecutionState(goal.id, state);
    expect(repo.getExecutionState(goal.id)).toEqual(state);
  });

  it("setExecutionState(id, null) clears the column", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "G" });
    repo.setExecutionState(goal.id, mkState());
    repo.setExecutionState(goal.id, null);
    expect(repo.getExecutionState(goal.id)).toBeNull();
  });

  it("findActiveNarratedByCeo returns goal in approved+state", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "G" });
    repo.updateStatus(goal.id, "planning");
    repo.updateStatus(goal.id, "proposed");
    repo.updateStatus(goal.id, "approved");
    repo.setExecutionState(goal.id, mkState());
    const found = repo.findActiveNarratedByCeo(ceoId);
    expect(found?.id).toBe(goal.id);
  });

  it("findActiveNarratedByCeo returns null when no goal is active", () => {
    const repo = createGoalsRepository(db);
    expect(repo.findActiveNarratedByCeo(ceoId)).toBeNull();
  });

  it("findStuckNarrated returns goals in approved with state present", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "Stuck" });
    repo.updateStatus(goal.id, "planning");
    repo.updateStatus(goal.id, "proposed");
    repo.updateStatus(goal.id, "approved");
    repo.setExecutionState(goal.id, { ...mkState(), step: "hiring" });
    const stuck = repo.findStuckNarrated();
    expect(stuck.map((g) => g.id)).toContain(goal.id);
  });
});
