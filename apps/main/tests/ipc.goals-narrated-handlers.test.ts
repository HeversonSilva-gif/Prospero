import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createGoalsRepository } from "../src/goals/repository.js";
import { createGoalPlansRepository } from "../src/goals/plans-repository.js";
import { narratedHandlers } from "../src/ipc/goals-narrated-handlers.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const co = createCompaniesRepository(db).create({ name: "A" });
  const ceo = createAgentsRepository(db).create({
    companyId: co.id,
    name: "CEO",
    role: "ceo",
    systemPrompt: "x",
    mode: "supervised",
    alwaysOn: true,
    model: "claude-opus-4-7",
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
  goalsRepo.updateStatus(goal.id, "approved");
  goalsRepo.setExecutionState(goal.id, {
    planId: plan.id,
    mode: "narrated",
    includeAgentIndexes: null,
    includeIssueIndexes: null,
    agentIndexToId: {},
    issueIndexToId: {},
    step: "hiring",
    startedAt: Date.now(),
    ceoId: ceo.id,
    threadId: "th_1",
  });
  return { db, co, ceo, goal, plan };
};

describe("narratedHandlers.resume", () => {
  it("re-enqueues CEO turn with the original execute request", () => {
    const env = setup();
    const enqueue = vi.fn((_ceoId: string, _prompt: string) => ({ threadId: "th_2" }));
    const h = narratedHandlers({
      db: env.db,
      orchestrator: { deliverSystemMessage: vi.fn(), enqueueExecuteRequest: enqueue },
    });
    const result = h.resume({ goalId: env.goal.id });
    expect(result).toEqual({ ok: true });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0]).toBe(env.ceo.id);
    expect(enqueue.mock.calls[0]?.[1]).toContain(env.goal.id);
  });

  it("rejects when goal has no execution state", () => {
    const env = setup();
    createGoalsRepository(env.db).setExecutionState(env.goal.id, null);
    const h = narratedHandlers({
      db: env.db,
      orchestrator: {
        deliverSystemMessage: vi.fn(),
        enqueueExecuteRequest: vi.fn(() => ({ threadId: "x" })),
      },
    });
    expect(() => h.resume({ goalId: env.goal.id })).toThrow(/no active/i);
  });
});

describe("narratedHandlers.rollback", () => {
  it("clears state, sets goal to cancelled, marks plan rejected", () => {
    const env = setup();
    const h = narratedHandlers({
      db: env.db,
      orchestrator: {
        deliverSystemMessage: vi.fn(),
        enqueueExecuteRequest: vi.fn(() => ({ threadId: "x" })),
      },
    });
    const result = h.rollback({ goalId: env.goal.id });
    expect(result).toEqual({ aborted: true });
    const after = createGoalsRepository(env.db).getById(env.goal.id);
    expect(after?.status).toBe("cancelled");
    expect(createGoalsRepository(env.db).getExecutionState(env.goal.id)).toBeNull();
  });
});
