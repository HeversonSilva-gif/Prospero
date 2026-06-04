import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalPlansRepository } from "../goals/plans-repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { goalsToolDefinitions } from "./tools-goals.js";
import type { ToolContext } from "./tools.js";
import type { ExecutionState } from "@prospero/shared";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO role_templates (id, name, description, default_system_prompt, default_capabilities_json, default_model, icon)
     VALUES ('role-engineer', 'Eng', 'x', 'x', '["shell"]', 'claude-sonnet-4-6', null)`,
  ).run();
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
      {
        index: 1,
        name: "Marcus",
        roleTemplateId: "role-engineer",
        model: "claude-sonnet-4-6",
        personaSummary: "sub",
        capabilities: ["shell"],
        reportsToIndex: 0,
        rationale: "x",
      },
    ],
    issuesToCreate: [],
    estimatedTotalTokens: null,
    estimatedDurationDays: null,
    estimatedCostCents: null,
    risks: [],
  });
  goalsRepo.updateStatus(goal.id, "proposed");
  goalsRepo.updateStatus(goal.id, "approved");
  const state: ExecutionState = {
    planId: plan.id,
    mode: "narrated",
    includeAgentIndexes: null,
    includeIssueIndexes: null,
    agentIndexToId: {},
    issueIndexToId: {},
    step: "starting",
    startedAt: Date.now(),
    ceoId: ceo.id,
    threadId: "th_1",
  };
  goalsRepo.setExecutionState(goal.id, state);
  return {
    db,
    ceo,
    goal,
    plan,
    co,
    ctx: {
      agentId: ceo.id,
      companyId: co.id,
      db,
      permissionsDir: "",
      userDataDir: "/tmp/userdata",
      emit: () => undefined,
    } as ToolContext,
  };
};

const findTool = (name: string) => {
  const t = goalsToolDefinitions.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
};

describe("hire_agent_for_plan", () => {
  it("hires the agent at planIndex=0 (reportsTo CEO)", async () => {
    const env = setup();
    const tool = findTool("hire_agent_for_plan");
    const result = JSON.parse(await tool.run({ planIndex: 0 }, env.ctx)) as {
      agentId: string;
      name: string;
    };
    expect(result.name).toBe("Sarah");
    const state = createGoalsRepository(env.db).getExecutionState(env.goal.id);
    expect(state?.agentIndexToId[0]).toBe(result.agentId);
  });

  it("is idempotent: same planIndex returns existing id", async () => {
    const env = setup();
    const tool = findTool("hire_agent_for_plan");
    const a = JSON.parse(await tool.run({ planIndex: 0 }, env.ctx)) as { agentId: string };
    const b = JSON.parse(await tool.run({ planIndex: 0 }, env.ctx)) as {
      agentId: string;
      existing?: boolean;
    };
    expect(b.agentId).toBe(a.agentId);
    expect(b.existing).toBe(true);
  });

  it("rejects when reports_to agent not yet hired", async () => {
    const env = setup();
    const tool = findTool("hire_agent_for_plan");
    await expect(tool.run({ planIndex: 1 }, env.ctx)).rejects.toThrow(
      /reportsToIndex.*not yet hired/i,
    );
  });

  it("resolves an abstract model preset to a real claude-* id (I2)", async () => {
    // Genesis/Planning audit I2: the narrated hire passed agentSpec.model raw, so
    // an abstract preset like "opus-4" was stored and spawned as `--model opus-4`
    // (unrecognized). The atomic + org paths resolve it; the narrated path must too.
    const env = setup();
    env.db.prepare("UPDATE goal_plans SET agents_to_hire_json = ? WHERE id = ?").run(
      JSON.stringify([
        {
          index: 0,
          name: "Sarah",
          roleTemplateId: "role-engineer",
          model: "opus-4",
          personaSummary: "lead",
          capabilities: ["shell"],
          reportsToIndex: "CEO",
          rationale: "x",
        },
      ]),
      env.plan.id,
    );
    const result = JSON.parse(
      await findTool("hire_agent_for_plan").run({ planIndex: 0 }, env.ctx),
    ) as { agentId: string };
    const agent = createAgentsRepository(env.db).getById(result.agentId);
    expect(agent?.model).toBe("claude-opus-4-8");
  });

  it("works when reports_to chain is satisfied", async () => {
    const env = setup();
    const tool = findTool("hire_agent_for_plan");
    await tool.run({ planIndex: 0 }, env.ctx);
    const result = JSON.parse(await tool.run({ planIndex: 1 }, env.ctx)) as { agentId: string };
    expect(result.agentId).toBeTruthy();
  });

  it("rejects planIndex excluded by filter", async () => {
    const env = setup();
    const goalsRepo = createGoalsRepository(env.db);
    const state = goalsRepo.getExecutionState(env.goal.id);
    if (state === null) throw new Error("setup error");
    state.includeAgentIndexes = [0];
    goalsRepo.setExecutionState(env.goal.id, state);
    const tool = findTool("hire_agent_for_plan");
    await expect(tool.run({ planIndex: 1 }, env.ctx)).rejects.toThrow(/excluded/i);
  });

  it("rejects when no active narrated execution", async () => {
    const env = setup();
    createGoalsRepository(env.db).setExecutionState(env.goal.id, null);
    const tool = findTool("hire_agent_for_plan");
    await expect(tool.run({ planIndex: 0 }, env.ctx)).rejects.toThrow(/no active narrated/i);
  });
});

describe("create_issue_for_plan", () => {
  const setupWithIssues = () => {
    const env = setup();
    env.db.prepare("UPDATE goal_plans SET issues_to_create_json = ? WHERE id = ?").run(
      JSON.stringify([
        {
          index: 0,
          title: "First",
          description: "",
          priority: "medium",
          assigneeIndex: 0,
          estimatedTokens: 5000,
          dependsOnIndexes: [],
          rationale: "x",
        },
        {
          index: 1,
          title: "Second",
          description: "",
          priority: "medium",
          assigneeIndex: 0,
          estimatedTokens: 5000,
          dependsOnIndexes: [0],
          rationale: "x",
        },
      ]),
      env.plan.id,
    );
    return env;
  };

  it("creates issue with assignee resolved from state", async () => {
    const env = setupWithIssues();
    const hire = findTool("hire_agent_for_plan");
    await hire.run({ planIndex: 0 }, env.ctx);
    const tool = findTool("create_issue_for_plan");
    const result = JSON.parse(await tool.run({ planIndex: 0 }, env.ctx)) as {
      issueId: string;
      title: string;
    };
    expect(result.title).toBe("First");
    const state = createGoalsRepository(env.db).getExecutionState(env.goal.id);
    expect(state?.issueIndexToId[0]).toBe(result.issueId);
  });

  it("rejects when assignee not yet hired", async () => {
    const env = setupWithIssues();
    const tool = findTool("create_issue_for_plan");
    await expect(tool.run({ planIndex: 0 }, env.ctx)).rejects.toThrow(/assignee.*not yet hired/i);
  });

  it("rejects when dep not yet created", async () => {
    const env = setupWithIssues();
    await findTool("hire_agent_for_plan").run({ planIndex: 0 }, env.ctx);
    const tool = findTool("create_issue_for_plan");
    await expect(tool.run({ planIndex: 1 }, env.ctx)).rejects.toThrow(/dep.*not.*created/i);
  });

  it("creates dependent issue populating depends_on_json", async () => {
    const env = setupWithIssues();
    await findTool("hire_agent_for_plan").run({ planIndex: 0 }, env.ctx);
    const tool = findTool("create_issue_for_plan");
    const r0 = JSON.parse(await tool.run({ planIndex: 0 }, env.ctx)) as { issueId: string };
    const r1 = JSON.parse(await tool.run({ planIndex: 1 }, env.ctx)) as { issueId: string };
    const row = env.db
      .prepare("SELECT depends_on_json FROM issues WHERE id = ?")
      .get(r1.issueId) as { depends_on_json: string };
    expect(JSON.parse(row.depends_on_json)).toEqual([r0.issueId]);
  });

  it("is idempotent: same planIndex returns existing id", async () => {
    const env = setupWithIssues();
    await findTool("hire_agent_for_plan").run({ planIndex: 0 }, env.ctx);
    const tool = findTool("create_issue_for_plan");
    const a = JSON.parse(await tool.run({ planIndex: 0 }, env.ctx)) as { issueId: string };
    const b = JSON.parse(await tool.run({ planIndex: 0 }, env.ctx)) as {
      issueId: string;
      existing?: boolean;
    };
    expect(b.issueId).toBe(a.issueId);
    expect(b.existing).toBe(true);
  });
});

describe("finalize_goal_execution", () => {
  const setupSimplePlan = () => {
    const env = setup();
    env.db.prepare("UPDATE goal_plans SET agents_to_hire_json = ? WHERE id = ?").run(
      JSON.stringify([
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
      ]),
      env.plan.id,
    );
    env.db.prepare("UPDATE goal_plans SET issues_to_create_json = ? WHERE id = ?").run(
      JSON.stringify([
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
      ]),
      env.plan.id,
    );
    return env;
  };

  it("rejects when execution incomplete", async () => {
    const env = setupSimplePlan();
    const tool = findTool("finalize_goal_execution");
    await expect(tool.run({ goalId: env.goal.id }, env.ctx)).rejects.toThrow(/incomplete/i);
  });

  it("happy path: transitions goal to in_progress and clears state", async () => {
    const env = setupSimplePlan();
    await findTool("hire_agent_for_plan").run({ planIndex: 0 }, env.ctx);
    await findTool("create_issue_for_plan").run({ planIndex: 0 }, env.ctx);
    const tool = findTool("finalize_goal_execution");
    const result = JSON.parse(await tool.run({ goalId: env.goal.id }, env.ctx)) as {
      ok: boolean;
      hiredAgentIds: string[];
      createdIssueIds: string[];
    };
    expect(result.ok).toBe(true);
    expect(result.hiredAgentIds).toHaveLength(1);
    expect(result.createdIssueIds).toHaveLength(1);
    const after = createGoalsRepository(env.db).getById(env.goal.id);
    expect(after?.status).toBe("in_progress");
    expect(createGoalsRepository(env.db).getExecutionState(env.goal.id)).toBeNull();
  });

  it("abort path: terminates agents, deletes issues, cancels goal", async () => {
    const env = setupSimplePlan();
    const hireRes = JSON.parse(
      await findTool("hire_agent_for_plan").run({ planIndex: 0 }, env.ctx),
    ) as { agentId: string };
    const issueRes = JSON.parse(
      await findTool("create_issue_for_plan").run({ planIndex: 0 }, env.ctx),
    ) as { issueId: string };
    const tool = findTool("finalize_goal_execution");
    const result = JSON.parse(await tool.run({ goalId: env.goal.id, abort: true }, env.ctx)) as {
      aborted: boolean;
    };
    expect(result.aborted).toBe(true);
    const after = createGoalsRepository(env.db).getById(env.goal.id);
    expect(after?.status).toBe("cancelled");
    expect(createGoalsRepository(env.db).getExecutionState(env.goal.id)).toBeNull();
    // Issue deleted, agent terminated (status='terminated' not deleted)
    expect(createIssuesRepository(env.db).getById(issueRes.issueId)).toBeNull();
    const agentAfter = createAgentsRepository(env.db).getById(hireRes.agentId);
    expect(agentAfter?.status).toBe("terminated");
  });

  it("rejects when goal has no active execution", async () => {
    const env = setupSimplePlan();
    createGoalsRepository(env.db).setExecutionState(env.goal.id, null);
    const tool = findTool("finalize_goal_execution");
    await expect(tool.run({ goalId: env.goal.id }, env.ctx)).rejects.toThrow(/no active/i);
  });
});
