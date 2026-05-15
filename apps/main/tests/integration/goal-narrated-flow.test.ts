import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { createCompaniesRepository } from "../../src/companies/repository.js";
import { createAgentsRepository } from "../../src/agents/repository.js";
import { createGoalsRepository } from "../../src/goals/repository.js";
import { createGoalPlansRepository } from "../../src/goals/plans-repository.js";
import { createIssuesRepository } from "../../src/issues/repository.js";
import { executePlanNarrated } from "../../src/goals/executor-narrated.js";
import { goalsToolDefinitions } from "../../src/mcp/tools-goals.js";
import type { ToolContext } from "../../src/mcp/tools.js";

describe("integration: goal narrated flow end-to-end", () => {
  it("simulates CEO calling tools in sequence and ends with goal in_progress", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      `INSERT INTO role_templates (id, name, description, default_system_prompt, default_capabilities_json, default_model, icon)
       VALUES ('role-engineer', 'Eng', 'x', 'x', '["shell"]', 'claude-sonnet-4-6', null)`,
    ).run();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
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
    const goal = goalsRepo.create({ companyId: co.id, title: "Ship v1" });
    goalsRepo.updateStatus(goal.id, "planning");
    const plan = plansRepo.insert({
      goalId: goal.id,
      version: 1,
      proposedByAgentId: ceo.id,
      summary: "Plan summary at least twenty chars here.",
      agentsToHire: [
        {
          index: 0,
          name: "Sarah",
          roleTemplateId: "role-engineer",
          model: "claude-sonnet-4-6",
          personaSummary: "lead",
          capabilities: ["shell"],
          reportsToIndex: "CEO",
          rationale: "x",
        },
      ],
      issuesToCreate: [
        {
          index: 0,
          title: "Skeleton",
          description: "",
          priority: "medium",
          assigneeIndex: 0,
          estimatedTokens: 5000,
          dependsOnIndexes: [],
          rationale: "x",
        },
      ],
      estimatedTotalTokens: 5000,
      estimatedDurationDays: 1,
      estimatedCostCents: 25,
      risks: [],
    });
    goalsRepo.updateStatus(goal.id, "proposed");

    const enqueue = vi.fn((_ceoId: string, _prompt: string) => ({ threadId: "th_1" }));
    const start = executePlanNarrated(
      db,
      plan.id,
      {},
      { orchestrator: { enqueueExecuteRequest: enqueue } },
    );
    expect(start.ok).toBe(true);
    expect(goalsRepo.getById(goal.id)?.status).toBe("approved");

    const ctx: ToolContext = {
      agentId: ceo.id,
      companyId: co.id,
      db,
      permissionsDir: "",
      userDataDir: "/tmp/userdata",
      emit: () => undefined,
    };
    const findTool = (n: string) => goalsToolDefinitions.find((t) => t.name === n);
    const hireTool = findTool("hire_agent_for_plan");
    const createTool = findTool("create_issue_for_plan");
    const finalizeTool = findTool("finalize_goal_execution");
    if (!hireTool || !createTool || !finalizeTool) throw new Error("tools missing");

    const hireRes = JSON.parse(await hireTool.run({ planIndex: 0 }, ctx)) as { agentId: string };
    expect(hireRes.agentId).toBeTruthy();

    const issueRes = JSON.parse(await createTool.run({ planIndex: 0 }, ctx)) as {
      issueId: string;
    };
    expect(issueRes.issueId).toBeTruthy();

    const finalRes = JSON.parse(await finalizeTool.run({ goalId: goal.id }, ctx)) as {
      ok: boolean;
      hiredAgentIds: string[];
      createdIssueIds: string[];
    };
    expect(finalRes.ok).toBe(true);
    expect(finalRes.hiredAgentIds).toEqual([hireRes.agentId]);
    expect(finalRes.createdIssueIds).toEqual([issueRes.issueId]);

    const finalGoal = goalsRepo.getById(goal.id);
    expect(finalGoal?.status).toBe("in_progress");
    expect(goalsRepo.getExecutionState(goal.id)).toBeNull();

    // Issue created with goal_id linked
    const goalIdRow = db
      .prepare("SELECT goal_id FROM issues WHERE id = ?")
      .get(issueRes.issueId) as { goal_id: string };
    expect(goalIdRow.goal_id).toBe(goal.id);
    // Plan marked approved
    expect(createGoalPlansRepository(db).getById(plan.id)?.status).toBe("approved");

    // Touch issue repo to silence unused import lint warning
    expect(createIssuesRepository(db).getById(issueRes.issueId)).not.toBeNull();
  });
});
