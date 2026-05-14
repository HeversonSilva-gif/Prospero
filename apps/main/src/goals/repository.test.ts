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
});
