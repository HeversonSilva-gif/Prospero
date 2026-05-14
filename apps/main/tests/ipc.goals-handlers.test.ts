import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { goalsHandlers } from "../src/ipc/goals-handlers.js";
import { createGoalsRepository } from "../src/goals/repository.js";
import { createGoalPlansRepository } from "../src/goals/plans-repository.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";

const stubOrchestrator = (): {
  calls: { agentId: string; text: string }[];
  deliverSystemMessage: (agentId: string, text: string) => void;
} => {
  const calls: { agentId: string; text: string }[] = [];
  return {
    calls,
    deliverSystemMessage: (agentId, text) => {
      calls.push({ agentId, text });
    },
  };
};

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createCompaniesRepository(db).create({ name: "Acme" });
  const ceo = createAgentsRepository(db).create({
    companyId: company.id,
    name: "CEO",
    role: "ceo",
    systemPrompt: "You are the CEO.",
    mode: "supervised",
    alwaysOn: true,
    model: "sonnet-4",
    templateId: "ceo",
  });
  const orch = stubOrchestrator();
  const h = goalsHandlers({ db, orchestrator: orch });
  return { db, companyId: company.id, ceoId: ceo.id, h, orch };
};

describe("goals IPC handlers", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it("create + list returns the new goal", async () => {
    const created = await env.h.create({ companyId: env.companyId, title: "Test goal" });
    const list = await env.h.list({ companyId: env.companyId });
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);
  });

  it("get returns goal + currentPlan + history", async () => {
    const created = await env.h.create({ companyId: env.companyId, title: "Test" });
    const detail = await env.h.get({ id: created.id });
    expect(detail.id).toBe(created.id);
    expect(detail.currentPlan).toBeNull();
    expect(detail.history).toEqual([]);
  });

  it("requestPlan transitions goal to planning and delivers system message", async () => {
    const created = await env.h.create({ companyId: env.companyId, title: "X" });
    await env.h.requestPlan({ goalId: created.id });
    expect(env.orch.calls).toHaveLength(1);
    expect(env.orch.calls[0]?.agentId).toBe(env.ceoId);
    expect(env.orch.calls[0]?.text).toMatch(/GOAL_PLAN_REQUEST/);
    const after = createGoalsRepository(env.db).getById(created.id);
    expect(after?.status).toBe("planning");
  });

  it("approvePlan invokes executor and transitions to in_progress", async () => {
    const created = await env.h.create({ companyId: env.companyId, title: "X" });
    await env.h.requestPlan({ goalId: created.id });
    const plans = createGoalPlansRepository(env.db);
    const goals = createGoalsRepository(env.db);
    const plan = plans.insert({
      goalId: created.id,
      version: 1,
      proposedByAgentId: env.ceoId,
      summary: "Summary spanning at least twenty characters of text.",
      agentsToHire: [],
      issuesToCreate: [],
      estimatedTotalTokens: null,
      estimatedDurationDays: null,
      estimatedCostCents: null,
      risks: [],
    });
    goals.updateStatus(created.id, "proposed");
    const result = await env.h.approvePlan({ planId: plan.id });
    expect(result.ok).toBe(true);
    expect(goals.getById(created.id)?.status).toBe("in_progress");
  });

  it("requestChanges supersedes existing plan and re-enqueues with [FEEDBACK]", async () => {
    const created = await env.h.create({ companyId: env.companyId, title: "X" });
    await env.h.requestPlan({ goalId: created.id });
    const plans = createGoalPlansRepository(env.db);
    const goals = createGoalsRepository(env.db);
    const plan = plans.insert({
      goalId: created.id,
      version: 1,
      proposedByAgentId: env.ceoId,
      summary: "Summary spanning at least twenty characters of text.",
      agentsToHire: [],
      issuesToCreate: [],
      estimatedTotalTokens: null,
      estimatedDurationDays: null,
      estimatedCostCents: null,
      risks: [],
    });
    goals.updateStatus(created.id, "proposed");
    env.orch.calls.length = 0;

    await env.h.requestChanges({ planId: plan.id, feedback: "Reduce scope" });
    expect(plans.getById(plan.id)?.status).toBe("superseded");
    expect(goals.getById(created.id)?.status).toBe("planning");
    expect(env.orch.calls).toHaveLength(1);
    expect(env.orch.calls[0]?.text).toContain("[FEEDBACK] Reduce scope");
  });

  it("rejectPlan marks plan rejected and goal cancelled", async () => {
    const created = await env.h.create({ companyId: env.companyId, title: "X" });
    await env.h.requestPlan({ goalId: created.id });
    const plans = createGoalPlansRepository(env.db);
    const goals = createGoalsRepository(env.db);
    const plan = plans.insert({
      goalId: created.id,
      version: 1,
      proposedByAgentId: env.ceoId,
      summary: "Summary spanning at least twenty characters of text.",
      agentsToHire: [],
      issuesToCreate: [],
      estimatedTotalTokens: null,
      estimatedDurationDays: null,
      estimatedCostCents: null,
      risks: [],
    });
    goals.updateStatus(created.id, "proposed");
    await env.h.rejectPlan({ planId: plan.id, reason: "Not aligned" });
    expect(plans.getById(plan.id)?.status).toBe("rejected");
    expect(goals.getById(created.id)?.status).toBe("cancelled");
  });
});
