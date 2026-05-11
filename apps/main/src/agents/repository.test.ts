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

describe("setSystemPrompt", () => {
  it("updates the agent system prompt", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput({ systemPrompt: "old" }));
    repo.setSystemPrompt(agent.id, "new prompt");
    expect(repo.getById(agent.id)?.systemPrompt).toBe("new prompt");
  });
});
