import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProposedRole, ProposedAgent } from "@prospero/shared";
import { applyMigrations } from "../db/migrations.js";
import { createAgentsRepository } from "./repository.js";
import { createRoleTemplatesRepository } from "./role-templates-repository.js";
import { createOrgPlansRepository } from "./org-plans-repository.js";
import { roleCharterPath } from "./role-library-dir.js";
import { applyOrgPlan } from "./apply-org-plan.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('ceo','c1','Boss','ceo','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  return db;
};

const roles: ProposedRole[] = [
  {
    index: 0,
    name: "Manager",
    description: "leads",
    charter: "# Manager charter",
    model: "claude-sonnet-4-6",
    capabilities: ["chat", "issues"],
    icon: "📋",
  },
  {
    index: 1,
    name: "Specialist",
    description: "does",
    charter: "# Specialist charter",
    model: "claude-sonnet-4-6",
    capabilities: ["chat"],
    icon: null,
  },
];
const agents: ProposedAgent[] = [
  { index: 0, name: "Ann", roleIndex: 0, reportsToIndex: "CEO", rationale: "r" },
  { index: 1, name: "Bob", roleIndex: 1, reportsToIndex: 0, rationale: "r" },
];

describe("applyOrgPlan", () => {
  let db: Database.Database;
  let userData: string;
  beforeEach(() => {
    db = newDb();
    userData = mkdtempSync(join(tmpdir(), "prospero-applyorg-"));
  });

  it("creates roles with charters on disk and agents wired into the hierarchy", () => {
    const plan = createOrgPlansRepository(db).insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "s",
      roles,
      agents,
    });
    const result = applyOrgPlan(db, userData, plan.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdRoleIds).toHaveLength(2);
    expect(result.hiredAgentIds).toHaveLength(2);

    const roleRepo = createRoleTemplatesRepository(db);
    expect(roleRepo.getById(result.createdRoleIds[0]!)?.name).toBe("Manager");
    expect(existsSync(roleCharterPath(userData, result.createdRoleIds[0]!))).toBe(true);

    const agentsRepo = createAgentsRepository(db);
    const ann = agentsRepo.getById(result.hiredAgentIds[0]!)!;
    const bob = agentsRepo.getById(result.hiredAgentIds[1]!)!;
    expect(ann.reportsTo).toBe("ceo");
    expect(bob.reportsTo).toBe(ann.id);

    expect(createOrgPlansRepository(db).getById(plan.id)?.status).toBe("approved");
  });

  it("disambiguates role names that already exist instead of failing on the UNIQUE constraint", () => {
    // A template named "Manager" already exists (e.g. a seed example or a prior org).
    createRoleTemplatesRepository(db).create({
      name: "Manager",
      description: "existing",
      icon: null,
      defaultModel: "claude-sonnet-4-6",
      defaultCapabilities: ["chat"],
    });
    const plan = createOrgPlansRepository(db).insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "s",
      roles,
      agents,
    });
    const result = applyOrgPlan(db, userData, plan.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roleRepo = createRoleTemplatesRepository(db);
    expect(roleRepo.getById(result.createdRoleIds[0]!)?.name).toBe("Manager (2)");
    // The agent still shows the original role name.
    const ann = createAgentsRepository(db).getById(result.hiredAgentIds[0]!)!;
    expect(ann.role).toBe("Manager");
  });

  it("applies only the included subset", () => {
    const plan = createOrgPlansRepository(db).insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "s",
      roles,
      agents,
    });
    const result = applyOrgPlan(db, userData, plan.id, {
      includeRoleIndexes: new Set([0]),
      includeAgentIndexes: new Set([0]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdRoleIds).toHaveLength(1);
    expect(result.hiredAgentIds).toHaveLength(1);
  });

  it("fails when the plan is not in 'proposed' status", () => {
    const repo = createOrgPlansRepository(db);
    const plan = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "s",
      roles,
      agents,
    });
    repo.markRejected(plan.id, null);
    const result = applyOrgPlan(db, userData, plan.id);
    expect(result.ok).toBe(false);
  });
});
