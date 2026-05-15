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

describe("integration: goal narrated abort path", () => {
  it("aborts mid-loop, rolls back hires + issues, cancels goal", async () => {
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
    const goal = goalsRepo.create({ companyId: co.id, title: "Cancel me" });
    goalsRepo.updateStatus(goal.id, "planning");
    const plan = plansRepo.insert({
      goalId: goal.id,
      version: 1,
      proposedByAgentId: ceo.id,
      summary: "Plan summary text here min twenty chars.",
      agentsToHire: [
        {
          index: 0,
          name: "Solo",
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
          title: "T",
          description: "",
          priority: "medium",
          assigneeIndex: 0,
          estimatedTokens: 5000,
          dependsOnIndexes: [],
          rationale: "x",
        },
      ],
      estimatedTotalTokens: null,
      estimatedDurationDays: null,
      estimatedCostCents: null,
      risks: [],
    });
    goalsRepo.updateStatus(goal.id, "proposed");

    executePlanNarrated(
      db,
      plan.id,
      {},
      { orchestrator: { enqueueExecuteRequest: vi.fn(() => ({ threadId: "th_1" })) } },
    );

    const ctx: ToolContext = {
      agentId: ceo.id,
      companyId: co.id,
      db,
      permissionsDir: "",
      emit: () => undefined,
    };
    const findTool = (n: string) => {
      const t = goalsToolDefinitions.find((x) => x.name === n);
      if (!t) throw new Error(`tool ${n} missing`);
      return t;
    };

    const hireRes = JSON.parse(
      await findTool("hire_agent_for_plan").run({ planIndex: 0 }, ctx),
    ) as { agentId: string };
    const issueRes = JSON.parse(
      await findTool("create_issue_for_plan").run({ planIndex: 0 }, ctx),
    ) as { issueId: string };

    const result = JSON.parse(
      await findTool("finalize_goal_execution").run({ goalId: goal.id, abort: true }, ctx),
    ) as { aborted: boolean };
    expect(result.aborted).toBe(true);

    expect(goalsRepo.getById(goal.id)?.status).toBe("cancelled");
    expect(goalsRepo.getExecutionState(goal.id)).toBeNull();
    expect(plansRepo.getById(plan.id)?.status).toBe("rejected");
    // Issue deleted, agent terminated
    expect(createIssuesRepository(db).getById(issueRes.issueId)).toBeNull();
    expect(createAgentsRepository(db).getById(hireRes.agentId)?.status).toBe("terminated");
  });
});
