import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { goalsHandlers } from "../../src/ipc/goals-handlers.js";
import { createGoalsRepository } from "../../src/goals/repository.js";
import { createGoalPlansRepository } from "../../src/goals/plans-repository.js";
import { createCompaniesRepository } from "../../src/companies/repository.js";
import { createAgentsRepository } from "../../src/agents/repository.js";

const newEnv = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createCompaniesRepository(db).create({ name: "Acme" });
  const agents = createAgentsRepository(db);
  const ceo = agents.create({
    companyId: company.id,
    name: "CEO",
    role: "ceo",
    systemPrompt: "You are the CEO.",
    mode: "supervised",
    alwaysOn: true,
    model: "sonnet-4",
    templateId: "ceo",
  });
  const orchCalls: { agentId: string; text: string }[] = [];
  const h = goalsHandlers({
    db,
    orchestrator: {
      deliverSystemMessage: (agentId, text) => {
        orchCalls.push({ agentId, text });
      },
      enqueueExecuteRequest: (ceoId, prompt) => {
        orchCalls.push({ agentId: ceoId, text: prompt });
        return { threadId: "th_test" };
      },
    },
  });
  return { db, companyId: company.id, ceoId: ceo.id, h, orchCalls };
};

describe("integration: goal flow happy path", () => {
  let env: ReturnType<typeof newEnv>;
  beforeEach(() => {
    env = newEnv();
  });

  it("user creates goal → asks CEO → CEO submits plan → user approves → execution succeeds", async () => {
    const goal = await env.h.create({ companyId: env.companyId, title: "Build login flow" });
    expect(goal.status).toBe("draft");

    await env.h.requestPlan({ goalId: goal.id });
    expect(env.orchCalls).toHaveLength(1);
    expect(env.orchCalls[0]?.text).toMatch(/GOAL_PLAN_REQUEST/);
    expect(createGoalsRepository(env.db).getById(goal.id)?.status).toBe("planning");

    const plans = createGoalPlansRepository(env.db);
    const plan = plans.insert({
      goalId: goal.id,
      version: 1,
      proposedByAgentId: env.ceoId,
      summary: "Build a login flow with 1 backend engineer in one issue.",
      agentsToHire: [
        {
          index: 0,
          name: "Sarah",
          roleTemplateId: "swe",
          model: "sonnet-4",
          personaSummary: "Senior backend engineer focused on OAuth flows.",
          skills: ["file_ops"],
          reportsToIndex: "CEO",
          rationale: "Needs OAuth expertise",
        },
      ],
      issuesToCreate: [
        {
          index: 0,
          title: "Wire OAuth provider",
          description: "Add provider config + callback handler",
          priority: "high",
          assigneeIndex: 0,
          estimatedTokens: 8000,
          dependsOnIndexes: [],
          rationale: "Foundation for auth",
        },
      ],
      estimatedTotalTokens: 8000,
      estimatedDurationDays: 1,
      estimatedCostCents: 40,
      risks: [],
    });
    createGoalsRepository(env.db).updateStatus(goal.id, "proposed");

    const result = await env.h.approvePlan({ planId: plan.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.hiredAgentIds).toHaveLength(1);
    expect(result.createdIssueIds).toHaveLength(1);

    const goalAfter = createGoalsRepository(env.db).getById(goal.id);
    expect(goalAfter?.status).toBe("in_progress");
    const planAfter = plans.getById(plan.id);
    expect(planAfter?.status).toBe("approved");
    const issueRow = env.db
      .prepare("SELECT * FROM issues WHERE id = ?")
      .get(result.createdIssueIds[0]) as { goal_id: string };
    expect(issueRow.goal_id).toBe(goal.id);
  });

  it("request-changes flow: v1 superseded → v2 created", async () => {
    const goal = await env.h.create({ companyId: env.companyId, title: "X" });
    await env.h.requestPlan({ goalId: goal.id });

    const plans = createGoalPlansRepository(env.db);
    const v1 = plans.insert({
      goalId: goal.id,
      version: 1,
      proposedByAgentId: env.ceoId,
      summary: "First version of the plan covering twenty plus characters.",
      agentsToHire: [],
      issuesToCreate: [],
      estimatedTotalTokens: null,
      estimatedDurationDays: null,
      estimatedCostCents: null,
      risks: [],
    });
    createGoalsRepository(env.db).updateStatus(goal.id, "proposed");
    env.orchCalls.length = 0;

    await env.h.requestChanges({ planId: v1.id, feedback: "Need more agents" });
    expect(plans.getById(v1.id)?.status).toBe("superseded");
    expect(createGoalsRepository(env.db).getById(goal.id)?.status).toBe("planning");
    expect(env.orchCalls).toHaveLength(1);
    expect(env.orchCalls[0]?.text).toContain("[FEEDBACK] Need more agents");
  });
});
