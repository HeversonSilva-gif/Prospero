import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { executePlan } from "./executor.js";
import { createGoalsRepository } from "./repository.js";
import { createGoalPlansRepository } from "./plans-repository.js";
import { createGoalCriteriaRepository } from "./criteria-repository.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import type { AgentToHire, IssueToCreate } from "@prospero/shared";

const setup = (): {
  db: Database.Database;
  companyId: string;
  ceoId: string;
} => {
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

const agentInput = (overrides: Partial<AgentToHire>): AgentToHire => ({
  index: 0,
  name: "Sarah",
  roleTemplateId: "swe",
  model: "sonnet-4",
  personaSummary: "Senior backend engineer focused on APIs.",
  capabilities: ["file_ops"],
  reportsToIndex: "CEO",
  rationale: "API expertise",
  ...overrides,
});

const issueInput = (overrides: Partial<IssueToCreate>): IssueToCreate => ({
  index: 0,
  title: "Build endpoint",
  description: "POST /users",
  priority: "high",
  assigneeIndex: 0,
  estimatedTokens: 5000,
  dependsOnIndexes: [],
  rationale: "Core feature",
  ...overrides,
});

describe("executePlan", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  const createApprovedReady = (
    agents: AgentToHire[],
    issues: IssueToCreate[],
  ): { goalId: string; planId: string } => {
    const goalsRepo = createGoalsRepository(env.db);
    const plansRepo = createGoalPlansRepository(env.db);
    const goal = goalsRepo.create({ companyId: env.companyId, title: "X" });
    goalsRepo.updateStatus(goal.id, "planning");
    goalsRepo.updateStatus(goal.id, "proposed");
    const plan = plansRepo.insert({
      goalId: goal.id,
      version: 1,
      proposedByAgentId: env.ceoId,
      summary: "Sample plan summary spanning at least twenty characters.",
      agentsToHire: agents,
      issuesToCreate: issues,
      estimatedTotalTokens: null,
      estimatedDurationDays: null,
      estimatedCostCents: null,
      risks: [],
    });
    return { goalId: goal.id, planId: plan.id };
  };

  it("hires 1 agent + creates 1 issue atomically", () => {
    const { planId, goalId } = createApprovedReady([agentInput({})], [issueInput({})]);
    const result = executePlan(env.db, planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hiredAgentIds).toHaveLength(1);
    expect(result.createdIssueIds).toHaveLength(1);
    const goal = createGoalsRepository(env.db).getById(goalId);
    expect(goal?.status).toBe("in_progress");
    // C3 (audit 2026-06-03): the goal must get an owner on execution, else trust
    // + the success retrospective stay dead for the main work path.
    expect(goal?.ownerAgentId).toBe(env.ceoId);
  });

  it("resolves reports_to_index pointing to another hired agent", () => {
    const { planId } = createApprovedReady(
      [
        agentInput({ index: 0, reportsToIndex: "CEO" }),
        agentInput({ index: 1, name: "Marcus", reportsToIndex: 0 }),
      ],
      [],
    );
    const result = executePlan(env.db, planId);
    expect(result.ok).toBe(true);
  });

  it("links issues.goal_id to the parent goal", () => {
    const { planId, goalId } = createApprovedReady([agentInput({})], [issueInput({})]);
    const result = executePlan(env.db, planId);
    if (!result.ok) throw new Error("unexpected fail");
    const row = env.db
      .prepare("SELECT goal_id FROM issues WHERE id = ?")
      .get(result.createdIssueIds[0]) as { goal_id: string };
    expect(row.goal_id).toBe(goalId);
  });

  it("rolls back when plan status is not 'proposed'", () => {
    const { planId } = createApprovedReady([agentInput({})], [issueInput({})]);
    createGoalPlansRepository(env.db).markApproved(planId, { decidedBy: "user" });
    const result = executePlan(env.db, planId);
    expect(result.ok).toBe(false);
  });

  it("excludes agents/issues when filter applied (via includeAgentIndexes)", () => {
    const { planId } = createApprovedReady(
      [agentInput({ index: 0 }), agentInput({ index: 1, name: "Marcus" })],
      [issueInput({ index: 0, assigneeIndex: 0 })],
    );
    const result = executePlan(env.db, planId, {
      includeAgentIndexes: new Set([0]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hiredAgentIds).toHaveLength(1);
  });

  it("assigns an issue to an EXISTING team member (no new hire) — reuse the team", () => {
    // Bug (2026-06-04): a plan could only assign to the CEO or a fresh hire, never
    // an agent already on the team. Now { existingAgentId } reuses the current team.
    const worker = createAgentsRepository(env.db).create({
      companyId: env.companyId,
      name: "Existing Dev",
      role: "engineer",
      systemPrompt: "x",
      mode: "supervised",
      alwaysOn: false,
      model: "sonnet-4",
      templateId: "engineer",
    });
    const { planId } = createApprovedReady(
      [], // no new hires
      [issueInput({ index: 0, assigneeIndex: { existingAgentId: worker.id } })],
    );
    const result = executePlan(env.db, planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hiredAgentIds).toHaveLength(0); // reused, not hired
    expect(result.createdIssueIds).toHaveLength(1);
    const issue = createIssuesRepository(env.db).getById(result.createdIssueIds[0]!);
    expect(issue?.assigneeId).toBe(worker.id);
  });

  it("rolls back when an existing-agent assignee id does not exist", () => {
    const { planId } = createApprovedReady(
      [],
      [issueInput({ index: 0, assigneeIndex: { existingAgentId: "agent_ghost" } })],
    );
    const result = executePlan(env.db, planId);
    expect(result.ok).toBe(false);
  });

  it("rolls back if filter leaves an issue's assignee unresolved", () => {
    const { planId } = createApprovedReady(
      [agentInput({ index: 0 }), agentInput({ index: 1, name: "Marcus" })],
      [issueInput({ index: 0, assigneeIndex: 1 })],
    );
    const result = executePlan(env.db, planId, {
      includeAgentIndexes: new Set([0]),
    });
    expect(result.ok).toBe(false);
  });

  it("populates issue_criteria when issue carries advancesCriteria", () => {
    const { goalId, planId } = createApprovedReady([agentInput({})], [issueInput({})]);
    // Seed a criterion that belongs to this goal.
    const criteriaRepo = createGoalCriteriaRepository(env.db);
    const criterion = criteriaRepo.create({
      goalId,
      statement: "Endpoint returns 200",
      kind: "judgment",
    });
    // Re-insert a fresh plan that carries advancesCriteria on the issue.
    // The plan created by createApprovedReady is already in 'proposed' state —
    // supersede it and insert a new one to avoid the "plan not proposed" guard.
    const plansRepo = createGoalPlansRepository(env.db);
    const goalsRepo = createGoalsRepository(env.db);
    plansRepo.markSuperseded(planId);
    goalsRepo.updateStatus(goalId, "planning");
    goalsRepo.updateStatus(goalId, "proposed");
    const plan2 = plansRepo.insert({
      goalId,
      version: 2,
      proposedByAgentId: env.ceoId,
      summary: "Sample plan summary spanning at least twenty characters.",
      agentsToHire: [agentInput({})],
      issuesToCreate: [issueInput({ advancesCriteria: [criterion.id] })],
      estimatedTotalTokens: null,
      estimatedDurationDays: null,
      estimatedCostCents: null,
      risks: [],
    });
    const result = executePlan(env.db, plan2.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const linked = env.db
      .prepare("SELECT COUNT(*) AS n FROM issue_criteria WHERE criterion_id = ?")
      .get(criterion.id) as { n: number };
    expect(linked.n).toBe(1);
  });
});
