import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const agents = createAgentsRepository(db);
  const company = companies.create({ name: "Kronos" });
  return { agents, companyId: company.id };
};

describe("agents repository", () => {
  it("create + listByCompany + getById", () => {
    const { agents, companyId } = setup();
    const ceo = agents.create({
      companyId,
      name: "CEO",
      role: "Chief Executive Officer",
      systemPrompt: "You are CEO.",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(ceo.status).toBe("idle");
    expect(agents.listByCompany(companyId)).toHaveLength(1);
    expect(agents.getById(ceo.id)?.name).toBe("CEO");
  });

  it("updateStatus mutates status and currentAction", () => {
    const { agents, companyId } = setup();
    const a = agents.create({
      companyId,
      name: "A",
      role: "x",
      systemPrompt: "x",
      mode: "auto",
      alwaysOn: false,
    });
    agents.updateStatus(a.id, { status: "thinking", currentAction: "considering" });
    const after = agents.getById(a.id);
    expect(after?.status).toBe("thinking");
    expect(after?.currentAction).toBe("considering");
  });

  it("setSessionId persists claude session id", () => {
    const { agents, companyId } = setup();
    const a = agents.create({
      companyId,
      name: "A",
      role: "x",
      systemPrompt: "x",
      mode: "auto",
      alwaysOn: false,
    });
    agents.setSessionId(a.id, "sess_123");
    expect(agents.getById(a.id)?.claudeSessionId).toBe("sess_123");
  });
});

describe("AgentsRepository - model field", () => {
  it("returns model field from rowToAgent (default sonnet)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "Eng",
      role: "Engineer",
      systemPrompt: "engineer system prompt long enough",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(a.model).toBe("claude-sonnet-4-6");
  });

  it("accepts model in CreateAgentInput", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "Boss",
      role: "CEO",
      systemPrompt: "ceo system prompt long enough",
      mode: "supervised",
      alwaysOn: false,
      model: "claude-opus-4-7",
    });
    expect(a.model).toBe("claude-opus-4-7");
  });

  it("falls back to DEFAULT_CLAUDE_MODEL when model is empty string", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "X",
      role: "X",
      systemPrompt: "long enough system prompt",
      mode: "supervised",
      alwaysOn: false,
      model: "",
    });
    expect(a.model).toBe("claude-sonnet-4-6");
  });
});

describe("AgentsRepository - skills + templateId", () => {
  it("returns empty skills + null templateId for a freshly created agent", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "Eng",
      role: "Engineer",
      systemPrompt: "long enough system prompt",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(a.skills).toEqual([]);
    expect(a.templateId).toBeNull();
  });

  it("create() persists skills + templateId when provided", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "Eng",
      role: "Engineer",
      systemPrompt: "long enough system prompt",
      mode: "supervised",
      alwaysOn: false,
      skills: ["shell", "fs-write"],
      templateId: "role-engineer",
    });
    expect(a.skills).toEqual(["shell", "fs-write"]);
    expect(a.templateId).toBe("role-engineer");
    const back = repo.getById(a.id);
    expect(back?.skills).toEqual(["shell", "fs-write"]);
    expect(back?.templateId).toBe("role-engineer");
  });
});
