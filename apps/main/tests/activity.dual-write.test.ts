// Integration tests for dual-write of activity_events across repositories.
// Extended incrementally per Task 9-13 of the M7.7 PR-A plan.

import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository, type CreateAgentInput } from "../src/agents/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";
import { createRecorder } from "../src/activity/recorder.js";
import { createActivityRepository } from "../src/activity/repository.js";

const setupAgents = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const company = companies.create({ name: "Acme" });
  const recorder = createRecorder(db, vi.fn(), { devMode: true });
  const agents = createAgentsRepository(db, recorder);
  const activity = createActivityRepository(db);
  return { agents, activity, companyId: company.id };
};

const baseAgent = (companyId: string, over: Partial<CreateAgentInput> = {}): CreateAgentInput => ({
  companyId,
  name: "BackendEng",
  role: "engineer",
  systemPrompt: "p",
  mode: "supervised",
  alwaysOn: false,
  model: "claude-sonnet-4-6",
  ...over,
});

const setupIssues = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const company = companies.create({ name: "Acme" });
  const recorder = createRecorder(db, vi.fn(), { devMode: true });
  const projects = createProjectsRepository(db);
  const project = projects.create({
    companyId: company.id,
    name: "Default",
    path: ".",
    color: "#888",
    slug: "DEF",
  });
  const issues = createIssuesRepository(db, recorder);
  const activity = createActivityRepository(db);
  return { issues, activity, companyId: company.id, projectId: project.id };
};

describe("dual-write — agents repository", () => {
  it("create emits agent.hired with default user actor", () => {
    const { agents, activity, companyId } = setupAgents();
    const agent = agents.create(baseAgent(companyId));
    const rows = activity.query({
      companyId,
      filters: { entityKind: "agent", entityId: agent.id },
    });
    const hired = rows.find((r) => r.action === "agent.hired");
    expect(hired).toBeDefined();
    expect(hired!.actorKind).toBe("user");
    expect((hired!.payload as { name: string }).name).toBe("BackendEng");
    expect((hired!.payload as { model: string }).model).toBe("claude-sonnet-4-6");
  });

  it("create honors explicit agent actor (MCP orchestrated)", () => {
    const { agents, activity, companyId } = setupAgents();
    agents.create(baseAgent(companyId, { actor: { kind: "agent", id: "agent_ceo" } }));
    const rows = activity.query({ companyId, filters: { action: "agent.hired" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorKind).toBe("agent");
    expect(rows[0]!.actorId).toBe("agent_ceo");
  });

  it("setModel emits agent.model_changed with from/to", () => {
    const { agents, activity, companyId } = setupAgents();
    const agent = agents.create(baseAgent(companyId, { model: "claude-sonnet-4-6" }));
    agents.setModel(agent.id, "claude-opus-4-7");
    const rows = activity.query({ companyId, filters: { action: "agent.model_changed" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ from: "claude-sonnet-4-6", to: "claude-opus-4-7" });
  });

  it("setSystemPrompt emits agent.persona_edited", () => {
    const { agents, activity, companyId } = setupAgents();
    const agent = agents.create(baseAgent(companyId));
    agents.setSystemPrompt(agent.id, "new persona body that is short");
    const rows = activity.query({ companyId, filters: { action: "agent.persona_edited" } });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { summary: string }).summary).toBe(
      "new persona body that is short",
    );
  });

  it("setAllowedProjects emits agent.allowed_projects_changed", () => {
    const { agents, activity, companyId } = setupAgents();
    const agent = agents.create(baseAgent(companyId));
    agents.setAllowedProjects(agent.id, ["proj_1", "proj_2"]);
    const rows = activity.query({
      companyId,
      filters: { action: "agent.allowed_projects_changed" },
    });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { projects: string[] }).projects).toEqual(["proj_1", "proj_2"]);
  });
});

describe("dual-write — issues repository", () => {
  it("create emits issue.created", () => {
    const { issues, activity, companyId, projectId } = setupIssues();
    const issue = issues.create(
      {
        companyId,
        projectId,
        title: "Build foo",
        description: null,
        assigneeId: null,
        priority: "medium",
        parentId: null,
        createdBy: null,
      },
      { actorKind: "user", actorId: null },
    );
    const rows = activity.query({
      companyId,
      filters: { entityKind: "issue", entityId: issue.id },
    });
    const created = rows.find((r) => r.action === "issue.created");
    expect(created).toBeDefined();
    expect((created!.payload as { title: string }).title).toBe("Build foo");
  });

  it("update(status) emits issue.status_changed", () => {
    const { issues, activity, companyId, projectId } = setupIssues();
    const issue = issues.create(
      {
        companyId,
        projectId,
        title: "T",
        description: null,
        assigneeId: null,
        priority: "medium",
        parentId: null,
        createdBy: null,
      },
      { actorKind: "user", actorId: null },
    );
    issues.update(issue.id, { status: "doing" }, { actorKind: "user", actorId: null });
    const rows = activity.query({ companyId, filters: { action: "issue.status_changed" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ from: "todo", to: "doing" });
  });
});

describe("dual-write — projects repository", () => {
  const setup = () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companies = createCompaniesRepository(db);
    const company = companies.create({ name: "Acme" });
    const recorder = createRecorder(db, vi.fn(), { devMode: true });
    const projects = createProjectsRepository(db, recorder);
    const activity = createActivityRepository(db);
    return { projects, activity, companyId: company.id };
  };

  it("create emits project.created", () => {
    const { projects, activity, companyId } = setup();
    const project = projects.create({
      companyId,
      name: "Backend",
      path: ".",
      color: "#abc",
    });
    const rows = activity.query({
      companyId,
      filters: { entityKind: "project", entityId: project.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("project.created");
    expect((rows[0]!.payload as { name: string }).name).toBe("Backend");
  });

  it("update emits project.updated with the patch", () => {
    const { projects, activity, companyId } = setup();
    const project = projects.create({ companyId, name: "Old", path: ".", color: "#abc" });
    projects.update(project.id, { name: "New" });
    const rows = activity.query({ companyId, filters: { action: "project.updated" } });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { patch: { name?: string } }).patch.name).toBe("New");
  });

  it("delete emits project.deleted with the name snapshot", () => {
    const { projects, activity, companyId } = setup();
    const project = projects.create({ companyId, name: "Doomed", path: ".", color: "#abc" });
    projects.delete(project.id);
    const rows = activity.query({ companyId, filters: { action: "project.deleted" } });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { name: string }).name).toBe("Doomed");
  });
});

describe("dual-write — issues repository (assignee)", () => {
  it("update(assignee) emits issue.assignee_changed", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companies = createCompaniesRepository(db);
    const company = companies.create({ name: "Acme" });
    const recorder = createRecorder(db, vi.fn(), { devMode: true });
    const projects = createProjectsRepository(db);
    const project = projects.create({
      companyId: company.id,
      name: "Default",
      path: ".",
      color: "#888",
      slug: "DEF",
    });
    // Create a real agent so the FK on issues.assignee_id resolves.
    const agents = createAgentsRepository(db);
    const assignee = agents.create({
      companyId: company.id,
      name: "Eng",
      role: "engineer",
      systemPrompt: "p",
      mode: "supervised",
      alwaysOn: false,
      model: "claude-sonnet-4-6",
    });
    const issues = createIssuesRepository(db, recorder);
    const activity = createActivityRepository(db);
    const issue = issues.create(
      {
        companyId: company.id,
        projectId: project.id,
        title: "T",
        description: null,
        assigneeId: null,
        priority: "medium",
        parentId: null,
        createdBy: null,
      },
      { actorKind: "user", actorId: null },
    );
    issues.update(issue.id, { assigneeId: assignee.id }, { actorKind: "user", actorId: null });
    const rows = activity.query({
      companyId: company.id,
      filters: { action: "issue.assignee_changed" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ from: null, to: assignee.id });
  });
});
