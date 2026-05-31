import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createGoalsRepository } from "./repository.js";
import { createGoalPlansRepository } from "./plans-repository.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";

const newDb = (): { db: Database.Database; companyId: string; agentId: string } => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createCompaniesRepository(db).create({ name: "Acme" });
  const agents = createAgentsRepository(db);
  const agent = agents.create({
    companyId: company.id,
    name: "CEO",
    role: "ceo",
    systemPrompt: "You are the CEO.",
    mode: "supervised",
    alwaysOn: true,
    model: "sonnet-4",
  });
  return { db, companyId: company.id, agentId: agent.id };
};

const samplePlan = (goalId: string, proposedByAgentId: string, version: number) => ({
  goalId,
  proposedByAgentId,
  version,
  summary: "Sample plan summary spanning at least twenty characters.",
  agentsToHire: [],
  issuesToCreate: [],
  estimatedTotalTokens: 5000,
  estimatedDurationDays: 1,
  estimatedCostCents: 25,
  risks: [],
});

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createCompaniesRepository(db).create({ name: "Acme" });
  const agent = createAgentsRepository(db).create({
    companyId: company.id,
    name: "CEO",
    role: "ceo",
    systemPrompt: "You are the CEO.",
    mode: "supervised",
    alwaysOn: true,
    model: "sonnet-4",
  });
  const goal = createGoalsRepository(db).create({ companyId: company.id, title: "Plan goal" });
  const repo = createGoalPlansRepository(db);
  return { db, companyId: company.id, agentId: agent.id, goalId: goal.id, repo };
};

const baseInsert = (goalId: string) => ({
  goalId,
  proposedByAgentId: "agent_placeholder",
  version: 1,
  summary: "Base insert summary spanning at least twenty characters.",
  agentsToHire: [] as [],
  issuesToCreate: [] as [],
  estimatedTotalTokens: null,
  estimatedDurationDays: null,
  estimatedCostCents: null,
  risks: [] as [],
});

describe("goalPlansRepository", () => {
  let env: ReturnType<typeof newDb>;
  beforeEach(() => {
    env = newDb();
  });

  it("inserts a plan v1 and reads it back with JSON deserialized", () => {
    const goal = createGoalsRepository(env.db).create({ companyId: env.companyId, title: "X" });
    const repo = createGoalPlansRepository(env.db);
    const plan = repo.insert(samplePlan(goal.id, env.agentId, 1));
    expect(plan.id).toMatch(/^plan_/);
    expect(plan.version).toBe(1);
    expect(plan.status).toBe("proposed");
    expect(plan.agentsToHire).toEqual([]);
    expect(plan.risks).toEqual([]);
  });

  it("rejects duplicate (goal_id, version)", () => {
    const goal = createGoalsRepository(env.db).create({ companyId: env.companyId, title: "X" });
    const repo = createGoalPlansRepository(env.db);
    repo.insert(samplePlan(goal.id, env.agentId, 1));
    expect(() => repo.insert(samplePlan(goal.id, env.agentId, 1))).toThrow();
  });

  it("computes next version", () => {
    const goal = createGoalsRepository(env.db).create({ companyId: env.companyId, title: "X" });
    const repo = createGoalPlansRepository(env.db);
    expect(repo.nextVersion(goal.id)).toBe(1);
    repo.insert(samplePlan(goal.id, env.agentId, 1));
    expect(repo.nextVersion(goal.id)).toBe(2);
  });

  it("returns currentPlan (latest non-superseded/rejected)", () => {
    const goal = createGoalsRepository(env.db).create({ companyId: env.companyId, title: "X" });
    const repo = createGoalPlansRepository(env.db);
    const v1 = repo.insert(samplePlan(goal.id, env.agentId, 1));
    expect(repo.getCurrent(goal.id)?.id).toBe(v1.id);

    repo.markSuperseded(v1.id);
    const v2 = repo.insert(samplePlan(goal.id, env.agentId, 2));
    expect(repo.getCurrent(goal.id)?.id).toBe(v2.id);
  });

  it("getHistory returns superseded+rejected ordered by version desc", () => {
    const goal = createGoalsRepository(env.db).create({ companyId: env.companyId, title: "X" });
    const repo = createGoalPlansRepository(env.db);
    const v1 = repo.insert(samplePlan(goal.id, env.agentId, 1));
    repo.markSuperseded(v1.id);
    const v2 = repo.insert(samplePlan(goal.id, env.agentId, 2));
    repo.markRejected(v2.id, "Bad plan");
    const history = repo.getHistory(goal.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.version).toBe(2);
    expect(history[1]?.version).toBe(1);
  });

  it("markApproved sets status, decidedBy, decidedAt", () => {
    const goal = createGoalsRepository(env.db).create({ companyId: env.companyId, title: "X" });
    const repo = createGoalPlansRepository(env.db);
    const v1 = repo.insert(samplePlan(goal.id, env.agentId, 1));
    repo.markApproved(v1.id, { decidedBy: "user" });
    const after = repo.getById(v1.id);
    expect(after?.status).toBe("approved");
    expect(after?.decidedBy).toBe("user");
    expect(after?.decidedAt).toBeGreaterThan(0);
  });

  it("inserts as critiquing when status is given, and getCurrent hides it", () => {
    const { repo, goalId, agentId } = setup();
    const plan = repo.insert({
      ...baseInsert(goalId),
      proposedByAgentId: agentId,
      status: "critiquing",
    });
    expect(plan.status).toBe("critiquing");
    expect(repo.getCurrent(goalId)).toBeNull();
  });

  it("markProposed flips critiquing → proposed (no-op otherwise)", () => {
    const { repo, goalId, agentId } = setup();
    const plan = repo.insert({
      ...baseInsert(goalId),
      proposedByAgentId: agentId,
      status: "critiquing",
    });
    repo.markProposed(plan.id);
    expect(repo.getById(plan.id)?.status).toBe("proposed");
    repo.markApproved(plan.id, { decidedBy: "user" });
    repo.markProposed(plan.id); // no-op on non-critiquing
    expect(repo.getById(plan.id)?.status).toBe("approved");
  });

  it("supersedeActiveForGoal supersedes proposed + critiquing", () => {
    const { repo, goalId, agentId } = setup();
    const a = repo.insert({
      ...baseInsert(goalId),
      proposedByAgentId: agentId,
      status: "critiquing",
    });
    repo.supersedeActiveForGoal(goalId);
    expect(repo.getById(a.id)?.status).toBe("superseded");
  });
});
