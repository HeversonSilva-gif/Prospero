import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runPostMigration0004 } from "../db/post-migrations/0004.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import { roleCharterPath } from "../agents/role-library-dir.js";
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

const tmpUserData = (): string => mkdtempSync(join(tmpdir(), "prospero-amd-hire-"));

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
      userDataDir: tmpUserData(),
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

  it("creates a role from the payload and writes its charter", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const userData = tmpUserData();
    const summary = hireFromAgentsMd(
      db,
      {
        company: "Acme",
        projects: [],
        roles: [
          {
            name: "Traffic Manager",
            description: "runs ads",
            model: "claude-sonnet-4-6",
            capabilities: ["web"],
            icon: "📈",
            charter: "# Traffic Manager\n\n## Identity\n\nLeads media buying.\n",
          },
        ],
        agents: [{ name: "Mara", role: "Traffic Manager" }],
      },
      { companyId: co.id, conflictModes: {}, userDataDir: userData },
    );
    expect(summary.created.roles).toBe(1);
    expect(summary.created.agents).toBe(1);
    const role = createRoleTemplatesRepository(db)
      .listAll()
      .find((r) => r.name === "Traffic Manager");
    expect(role).toBeDefined();
    expect(existsSync(roleCharterPath(userData, role!.id))).toBe(true);
  });

  it("skips a role whose name already exists", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const summary = hireFromAgentsMd(
      db,
      {
        company: "Acme",
        projects: [],
        roles: [{ name: "Engineer", charter: "# x" }],
        agents: [{ name: "Ann", role: "Engineer" }],
      },
      { companyId: co.id, conflictModes: {}, userDataDir: tmpUserData() },
    );
    expect(summary.created.roles).toBe(0);
    expect(summary.skipped.roles).toEqual(["Engineer"]);
    expect(summary.created.agents).toBe(1);
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
      { companyId: co.id, conflictModes: {}, userDataDir: tmpUserData() },
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
      { companyId: co.id, conflictModes: { Alice: "replace" }, userDataDir: tmpUserData() },
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
      { companyId: co.id, conflictModes: {}, userDataDir: tmpUserData() },
    );

    expect(summary.created.agents).toBe(0);
    expect(summary.skipped.agents).toEqual(["Zed"]);
    expect(summary.warnings.length).toBe(1);
    expect(summary.warnings[0]).toMatch(/unknown role/);
  });

  it("resolves an imported preset alias to a real model id", () => {
    // Audit 2026-06-03 Inteligência & Contexto M4: "opus-4" must reach create()
    // as the resolved real id, not the alias.
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const summary = hireFromAgentsMd(
      db,
      {
        company: "Acme",
        projects: [],
        agents: [{ name: "Ada", role: "engineer", model: "opus-4" }],
      },
      { companyId: co.id, conflictModes: {}, userDataDir: tmpUserData() },
    );
    expect(summary.created.agents).toBe(1);
    expect(summary.warnings).toEqual([]);
    const ada = createAgentsRepository(db)
      .listByCompany(co.id)
      .find((a) => a.name === "Ada");
    expect(ada?.model).toBe("claude-opus-4-8");
  });

  it("rejects an invalid imported model and falls back to the role default + warns", () => {
    // M4: a model id with shell-unsafe characters must never reach --model.
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const summary = hireFromAgentsMd(
      db,
      {
        company: "Acme",
        projects: [],
        agents: [{ name: "Eve", role: "engineer", model: "rm -rf /" }],
      },
      { companyId: co.id, conflictModes: {}, userDataDir: tmpUserData() },
    );
    expect(summary.created.agents).toBe(1);
    expect(summary.warnings.length).toBe(1);
    expect(summary.warnings[0]).toMatch(/invalid model/);
    const eve = createAgentsRepository(db)
      .listByCompany(co.id)
      .find((a) => a.name === "Eve");
    // role-engineer default model
    expect(eve?.model).toBe("claude-sonnet-4-6");
  });

  it("resolves a role's imported preset alias to a real model id", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const summary = hireFromAgentsMd(
      db,
      {
        company: "Acme",
        projects: [],
        roles: [{ name: "Strategist", model: "opus-4" }],
        agents: [{ name: "Sun", role: "Strategist" }],
      },
      { companyId: co.id, conflictModes: {}, userDataDir: tmpUserData() },
    );
    expect(summary.created.roles).toBe(1);
    const role = createRoleTemplatesRepository(db)
      .listAll()
      .find((r) => r.name === "Strategist");
    expect(role?.defaultModel).toBe("claude-opus-4-8");
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
      { companyId: co.id, conflictModes: {}, userDataDir: tmpUserData() },
    );

    expect(summary.created.projects).toBe(0);
    expect(summary.skipped.projects).toEqual(["new-name"]);
  });
});
