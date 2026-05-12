// Integration tests for dual-write of activity_events across repositories.
// Extended incrementally per Task 9-13 of the M7.7 PR-A plan.

import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository, type CreateAgentInput } from "../src/agents/repository.js";
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
