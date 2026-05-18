import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createCostsRepository, type CostEventInsert } from "./repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

const makeAgent = (db: Database.Database, companyId: string, name: string): string =>
  createAgentsRepository(db).create({
    companyId,
    name,
    role: "role-engineer",
    systemPrompt: "",
    mode: "supervised",
    alwaysOn: false,
    templateId: "role-engineer",
    actor: { kind: "user" },
  }).id;

const turn = (over: Partial<CostEventInsert>): CostEventInsert => ({
  companyId: "",
  agentId: null,
  projectId: null,
  issueId: null,
  adapterName: "claude-oauth-local",
  model: "claude-sonnet-4-6",
  sessionId: "sess-1",
  inputTokens: 10,
  outputTokens: 5,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costCentsEstimate: 3,
  occurredAt: 1000,
  ...over,
});

describe("createCostsRepository.listRunsByAgent", () => {
  it("returns the agent's runs newest-first", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "Alice");
    const repo = createCostsRepository(db);
    repo.insert(turn({ companyId: co.id, agentId, occurredAt: 1000 }));
    repo.insert(turn({ companyId: co.id, agentId, occurredAt: 3000 }));
    repo.insert(turn({ companyId: co.id, agentId, occurredAt: 2000 }));

    const runs = repo.listRunsByAgent(agentId);

    expect(runs.map((r) => r.occurredAt)).toEqual([3000, 2000, 1000]);
    expect(runs[0]!.inputTokens).toBe(10);
    expect(runs[0]!.adapterName).toBe("claude-oauth-local");
    expect(runs[0]!.sessionId).toBe("sess-1");
  });

  it("honors the limit argument", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "Alice");
    const repo = createCostsRepository(db);
    for (let i = 0; i < 5; i++) repo.insert(turn({ companyId: co.id, agentId, occurredAt: i }));

    expect(repo.listRunsByAgent(agentId, 2)).toHaveLength(2);
  });

  it("returns only the requested agent's runs", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const a = makeAgent(db, co.id, "Alice");
    const b = makeAgent(db, co.id, "Bob");
    const repo = createCostsRepository(db);
    repo.insert(turn({ companyId: co.id, agentId: a, occurredAt: 1 }));
    repo.insert(turn({ companyId: co.id, agentId: b, occurredAt: 2 }));

    const runs = repo.listRunsByAgent(a);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.agentId).toBe(a);
  });

  it("clamps the limit to the [1, 500] range", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentId = makeAgent(db, co.id, "Alice");
    const repo = createCostsRepository(db);
    for (let i = 0; i < 3; i++) repo.insert(turn({ companyId: co.id, agentId, occurredAt: i }));

    // limit 0 clamps up to 1 — never returns zero rows for a bad input
    expect(repo.listRunsByAgent(agentId, 0)).toHaveLength(1);
    // limit far above 500 still returns all available rows, not an error
    expect(repo.listRunsByAgent(agentId, 9999)).toHaveLength(3);
  });
});
