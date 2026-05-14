import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createGoalsRepository } from "./repository.js";
import { createGoalPlansRepository } from "./plans-repository.js";
import { executePlanNarrated } from "./executor-narrated.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const co = createCompaniesRepository(db).create({ name: "Acme" });
  const ceo = createAgentsRepository(db).create({
    companyId: co.id,
    name: "CEO",
    role: "ceo",
    systemPrompt: "x",
    mode: "supervised",
    alwaysOn: true,
    model: "claude-sonnet-4-6",
    templateId: "ceo",
  });
  const goalsRepo = createGoalsRepository(db);
  const plansRepo = createGoalPlansRepository(db);
  const goal = goalsRepo.create({ companyId: co.id, title: "G" });
  goalsRepo.updateStatus(goal.id, "planning");
  const plan = plansRepo.insert({
    goalId: goal.id,
    version: 1,
    proposedByAgentId: ceo.id,
    summary: "x",
    agentsToHire: [],
    issuesToCreate: [],
    estimatedTotalTokens: null,
    estimatedDurationDays: null,
    estimatedCostCents: null,
    risks: [],
  });
  goalsRepo.updateStatus(goal.id, "proposed");
  return { db, co, ceo, goal, plan };
};

describe("executePlanNarrated", () => {
  it("transitions goal to approved, persists state, and enqueues CEO turn", () => {
    const env = setup();
    const enqueue = vi.fn(() => ({ threadId: "th_1" }));
    const result = executePlanNarrated(
      env.db,
      env.plan.id,
      {},
      { orchestrator: { enqueueExecuteRequest: enqueue } },
    );
    expect(result.ok).toBe(true);
    expect(enqueue).toHaveBeenCalledOnce();
    const after = createGoalsRepository(env.db).getById(env.goal.id);
    expect(after?.status).toBe("approved");
    const state = createGoalsRepository(env.db).getExecutionState(env.goal.id);
    expect(state).not.toBeNull();
    expect(state?.planId).toBe(env.plan.id);
    expect(state?.threadId).toBe("th_1");
    expect(state?.ceoId).toBe(env.ceo.id);
  });

  it("rejects when plan not in 'proposed' state", () => {
    const env = setup();
    createGoalPlansRepository(env.db).markRejected(env.plan.id, "test");
    const result = executePlanNarrated(
      env.db,
      env.plan.id,
      {},
      { orchestrator: { enqueueExecuteRequest: vi.fn(() => ({ threadId: "x" })) } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedAtStep).toBe("load-plan");
  });

  it("rejects when no CEO exists in the company", () => {
    const env = setup();
    // Demote the only CEO so the lookup misses (template_id/role both = something else).
    env.db
      .prepare("UPDATE agents SET template_id = 'role-engineer', role = 'engineer' WHERE id = ?")
      .run(env.ceo.id);
    const result = executePlanNarrated(
      env.db,
      env.plan.id,
      {},
      { orchestrator: { enqueueExecuteRequest: vi.fn(() => ({ threadId: "x" })) } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedAtStep).toBe("lookup-ceo");
  });

  it("persists includeAgentIndexes/includeIssueIndexes when provided", () => {
    const env = setup();
    const enqueue = vi.fn(() => ({ threadId: "th_x" }));
    executePlanNarrated(
      env.db,
      env.plan.id,
      { includeAgentIndexes: new Set([0, 2]), includeIssueIndexes: new Set([1]) },
      { orchestrator: { enqueueExecuteRequest: enqueue } },
    );
    const state = createGoalsRepository(env.db).getExecutionState(env.goal.id);
    expect(state?.includeAgentIndexes).toEqual([0, 2]);
    expect(state?.includeIssueIndexes).toEqual([1]);
  });
});
