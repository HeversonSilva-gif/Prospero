import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentsRepository, type CreateAgentInput } from "./repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
  return db;
};

const baseInput = (over: Partial<CreateAgentInput> = {}): CreateAgentInput => ({
  companyId: "c1",
  name: "A",
  role: "r",
  systemPrompt: "p",
  mode: "supervised",
  alwaysOn: false,
  model: "claude-sonnet-4-6",
  skills: ["chat"],
  ...over,
});

describe("setModel", () => {
  it("updates the agent model column", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput());
    repo.setModel(agent.id, "claude-opus-4-7");
    expect(repo.getById(agent.id)?.model).toBe("claude-opus-4-7");
  });
});

describe("create — adapter_name", () => {
  it("defaults to claude-oauth-local", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(a.adapterName).toBe("claude-oauth-local");
  });

  it("respects explicit adapterName input", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput({ adapterName: "claude-api-key-local" }));
    expect(a.adapterName).toBe("claude-api-key-local");
  });
});

describe("setSystemPrompt", () => {
  it("updates the agent system prompt", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput({ systemPrompt: "old" }));
    repo.setSystemPrompt(agent.id, "new prompt");
    expect(repo.getById(agent.id)?.systemPrompt).toBe("new prompt");
  });
});

const seedRole = (db: Database.Database, id: string, model: string, skills: string[]): void => {
  db.prepare(
    `INSERT OR REPLACE INTO role_templates (id, name, description, default_system_prompt, default_skills_json, default_model, icon)
     VALUES (?, ?, '', 'p', ?, ?, NULL)`,
  ).run(id, id, JSON.stringify(skills), model);
};

describe("setRole", () => {
  it("atomically updates template_id, skills, and model from role_template", () => {
    const db = setupDb();
    seedRole(db, "role-engineer", "claude-sonnet-4-6", ["shell", "chat"]);
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput({ model: "claude-haiku-4-5-20251001", skills: ["chat"] }));
    repo.setRole(agent.id, "role-engineer");
    const updated = repo.getById(agent.id);
    expect(updated?.templateId).toBe("role-engineer");
    expect(updated?.skills).toEqual(["shell", "chat"]);
    expect(updated?.model).toBe("claude-sonnet-4-6");
  });

  it("does NOT overwrite model when preserveModel=true", () => {
    const db = setupDb();
    seedRole(db, "role-engineer", "claude-sonnet-4-6", ["shell"]);
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput({ model: "claude-opus-4-7", skills: [] }));
    repo.setRole(agent.id, "role-engineer", { preserveModel: true });
    expect(repo.getById(agent.id)?.model).toBe("claude-opus-4-7");
    expect(repo.getById(agent.id)?.skills).toEqual(["shell"]);
  });

  it("throws when role_template_id does not exist", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput());
    expect(() => repo.setRole(agent.id, "role-nonexistent")).toThrow();
  });
});

describe("setReportsTo", () => {
  it("updates reports_to to a new parent", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const ceo = repo.create(baseInput({ name: "CEO" }));
    const eng = repo.create(baseInput({ name: "Eng" }));
    repo.setReportsTo(eng.id, ceo.id);
    expect(repo.getById(eng.id)?.reportsTo).toBe(ceo.id);
  });

  it("accepts null parent (detach to root)", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const ceo = repo.create(baseInput({ name: "CEO" }));
    const eng = repo.create(baseInput({ name: "Eng" }));
    repo.setReportsTo(eng.id, ceo.id);
    repo.setReportsTo(eng.id, null);
    expect(repo.getById(eng.id)?.reportsTo).toBeNull();
  });

  it("rejects self as parent", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(() => repo.setReportsTo(a.id, a.id)).toThrow(/cycle|self/i);
  });

  it("rejects a descendant as parent (cycle)", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const ceo = repo.create(baseInput({ name: "CEO" }));
    const eng = repo.create(baseInput({ name: "Eng" }));
    repo.setReportsTo(eng.id, ceo.id);
    expect(() => repo.setReportsTo(ceo.id, eng.id)).toThrow(/cycle/i);
  });
});
