import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPostMigration0004 } from "../db/post-migrations/0004.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { hireFromAgentsMd } from "./hire.js";
import type { AgentsMdPayload } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  runPostMigration0004(db);
  return db;
};

const PAYLOAD: AgentsMdPayload = {
  company: "Acme",
  projects: [{ name: "backend", path: "D:/code/backend" }],
  agents: [
    { name: "Alice", role: "engineer" },
    { name: "Bob", role: "qa", reports_to: "Alice" },
  ],
};

describe("hireFromAgentsMd", () => {
  it("creates projects + agents and wires reports_to", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });

    const summary = hireFromAgentsMd(db, PAYLOAD, {
      companyId: co.id,
      conflictModes: {},
    });

    expect(summary.companyId).toBe(co.id);
    expect(summary.created.projects).toBe(1);
    expect(summary.created.agents).toBe(2);
    expect(summary.warnings).toEqual([]);

    const projects = createProjectsRepository(db).listByCompany(co.id);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("backend");

    const agents = createAgentsRepository(db).listByCompany(co.id);
    expect(agents).toHaveLength(2);
    const bob = agents.find((a) => a.name === "Bob");
    const alice = agents.find((a) => a.name === "Alice");
    expect(bob?.reportsTo).toBe(alice?.id);
  });
});

describe("hireFromAgentsMd conflict resolution", () => {
  it("skips agent when conflictMode is 'skip' (default)", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentsRepo = createAgentsRepository(db);
    const existing = agentsRepo.create({
      companyId: co.id,
      name: "Alice",
      role: "role-engineer",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: "role-engineer",
      actor: { kind: "user" },
    });

    const summary = hireFromAgentsMd(
      db,
      { company: "Acme", projects: [], agents: [{ name: "Alice", role: "engineer" }] },
      { companyId: co.id, conflictModes: {} },
    );

    expect(summary.created.agents).toBe(0);
    expect(summary.skipped.agents).toEqual(["Alice"]);
    expect(agentsRepo.listByCompany(co.id).filter((a) => a.terminatedAt === null)).toHaveLength(1);
    expect(agentsRepo.getById(existing.id)?.terminatedAt).toBeNull();
  });

  it("terminates + recreates agent when conflictMode is 'replace'", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agentsRepo = createAgentsRepository(db);
    const old = agentsRepo.create({
      companyId: co.id,
      name: "Alice",
      role: "role-engineer",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: "role-engineer",
      actor: { kind: "user" },
    });

    const summary = hireFromAgentsMd(
      db,
      { company: "Acme", projects: [], agents: [{ name: "Alice", role: "qa" }] },
      { companyId: co.id, conflictModes: { Alice: "replace" } },
    );

    expect(summary.replaced.agents).toEqual(["Alice"]);
    expect(summary.created.agents).toBe(1);
    expect(agentsRepo.getById(old.id)?.terminatedAt).not.toBeNull();
    const live = agentsRepo.listByCompany(co.id).filter((a) => a.terminatedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0]?.role).toBe("role-qa");
    expect(live[0]?.id).not.toBe(old.id);
  });

  it("warns + skips agent with unknown role", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });

    const summary = hireFromAgentsMd(
      db,
      { company: "Acme", projects: [], agents: [{ name: "Zed", role: "wizard" }] },
      { companyId: co.id, conflictModes: {} },
    );

    expect(summary.created.agents).toBe(0);
    expect(summary.skipped.agents).toEqual(["Zed"]);
    expect(summary.warnings.length).toBe(1);
    expect(summary.warnings[0]).toMatch(/unknown role/);
  });

  it("skips project when path already exists", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    createProjectsRepository(db).create({
      companyId: co.id,
      name: "existing",
      path: "D:/code/backend",
      color: "#000",
    });

    const summary = hireFromAgentsMd(
      db,
      {
        company: "Acme",
        projects: [{ name: "new-name", path: "D:/code/backend" }],
        agents: [{ name: "A", role: "engineer" }],
      },
      { companyId: co.id, conflictModes: {} },
    );

    expect(summary.created.projects).toBe(0);
    expect(summary.skipped.projects).toEqual(["new-name"]);
  });
});
