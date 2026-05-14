import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { scanPlanningWithoutPlan, scanStuckNarrated } from "./recovery.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createGoalsRepository } from "./repository.js";
import { createGoalPlansRepository } from "./plans-repository.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";

const setup = (): { db: Database.Database; companyId: string; ceoId: string } => {
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
  return { db, companyId: company.id, ceoId: ceo.id };
};

describe("scanPlanningWithoutPlan", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it("returns 0 when no goals exist", () => {
    const enqueued: string[] = [];
    const count = scanPlanningWithoutPlan(env.db, {
      deliverSystemMessage: (agentId, text) => {
        enqueued.push(`${agentId}::${text}`);
      },
    });
    expect(count).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("re-enqueues GOAL_PLAN_REQUEST for goals stuck in planning with no proposed plan", () => {
    const goals = createGoalsRepository(env.db);
    const g = goals.create({ companyId: env.companyId, title: "Stuck" });
    goals.updateStatus(g.id, "planning");

    const enqueued: { agentId: string; text: string }[] = [];
    const count = scanPlanningWithoutPlan(env.db, {
      deliverSystemMessage: (agentId, text) => {
        enqueued.push({ agentId, text });
      },
    });
    expect(count).toBe(1);
    expect(enqueued[0]?.agentId).toBe(env.ceoId);
    expect(enqueued[0]?.text).toMatch(/^\[GOAL_PLAN_REQUEST\]/);
    expect(enqueued[0]?.text).toContain("goal_id=" + g.id);
  });

  it("does NOT re-enqueue when a proposed plan already exists", () => {
    const goals = createGoalsRepository(env.db);
    const plans = createGoalPlansRepository(env.db);
    const g = goals.create({ companyId: env.companyId, title: "X" });
    goals.updateStatus(g.id, "planning");
    plans.insert({
      goalId: g.id,
      version: 1,
      proposedByAgentId: env.ceoId,
      summary: "Summary long enough to validate at twenty characters minimum.",
      agentsToHire: [],
      issuesToCreate: [],
      estimatedTotalTokens: null,
      estimatedDurationDays: null,
      estimatedCostCents: null,
      risks: [],
    });

    let called = 0;
    scanPlanningWithoutPlan(env.db, {
      deliverSystemMessage: () => {
        called++;
      },
    });
    expect(called).toBe(0);
  });

  it("skips companies without a CEO", () => {
    const otherCompany = createCompaniesRepository(env.db).create({ name: "B" });
    const goals = createGoalsRepository(env.db);
    const g = goals.create({ companyId: otherCompany.id, title: "Orphan" });
    goals.updateStatus(g.id, "planning");

    let called = 0;
    scanPlanningWithoutPlan(env.db, {
      deliverSystemMessage: () => {
        called++;
      },
    });
    expect(called).toBe(0);
  });
});

describe("scanStuckNarrated", () => {
  it("creates inbox goal_error for goals stuck in narrated execution", () => {
    const env = setup();
    const goals = createGoalsRepository(env.db);
    const goal = goals.create({ companyId: env.companyId, title: "Stuck" });
    goals.updateStatus(goal.id, "planning");
    goals.updateStatus(goal.id, "proposed");
    goals.updateStatus(goal.id, "approved");
    goals.setExecutionState(goal.id, {
      planId: "p_x",
      mode: "narrated",
      includeAgentIndexes: null,
      includeIssueIndexes: null,
      agentIndexToId: { 0: "ag_1" },
      issueIndexToId: {},
      step: "hiring",
      startedAt: Date.now(),
      ceoId: env.ceoId,
      threadId: "th_1",
    });

    const created = scanStuckNarrated(env.db);

    expect(created).toHaveLength(1);
    const inbox = createInboxRepository(env.db).listByCompany(env.companyId);
    const stuckItem = inbox.find((i) => i.kind === "goal_error");
    expect(stuckItem).toBeDefined();
    expect(stuckItem?.title).toContain("Stuck");
    const payload = JSON.parse(stuckItem!.payloadJson!) as { step: string; goalId: string };
    expect(payload.step).toBe("narrated_halted");
    expect(payload.goalId).toBe(goal.id);
  });

  it("does NOT create inbox for goals in approved without execution state", () => {
    const env = setup();
    const goals = createGoalsRepository(env.db);
    const goal = goals.create({ companyId: env.companyId, title: "Clean" });
    goals.updateStatus(goal.id, "planning");
    goals.updateStatus(goal.id, "proposed");
    goals.updateStatus(goal.id, "approved");
    const created = scanStuckNarrated(env.db);
    expect(created).toEqual([]);
  });
});
