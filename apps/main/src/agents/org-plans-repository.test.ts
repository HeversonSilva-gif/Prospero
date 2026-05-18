import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import type { ProposedRole, ProposedAgent } from "@prospero/shared";
import { applyMigrations } from "../db/migrations.js";
import { createOrgPlansRepository } from "./org-plans-repository.js";

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
    description: "d",
    charter: "# Manager",
    model: "claude-sonnet-4-6",
    capabilities: ["chat"],
    icon: null,
  },
];
const agents: ProposedAgent[] = [
  { index: 0, name: "Ann", roleIndex: 0, reportsToIndex: "CEO", rationale: "r" },
];

describe("orgPlansRepository", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("insert + getById round-trips roles and agents", () => {
    const repo = createOrgPlansRepository(db);
    const plan = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "a plan",
      roles,
      agents,
    });
    expect(plan.id).toMatch(/^orgplan_/);
    expect(plan.status).toBe("proposed");
    const got = repo.getById(plan.id);
    expect(got?.roles[0]?.name).toBe("Manager");
    expect(got?.agents[0]?.reportsToIndex).toBe("CEO");
  });

  it("getCurrentForCompany returns the proposed plan", () => {
    const repo = createOrgPlansRepository(db);
    const plan = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "a plan",
      roles,
      agents,
    });
    expect(repo.getCurrentForCompany("c1")?.id).toBe(plan.id);
  });

  it("markSuperseded / markApproved / markRejected change status", () => {
    const repo = createOrgPlansRepository(db);
    const a = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "first",
      roles,
      agents,
    });
    repo.markSuperseded(a.id);
    expect(repo.getById(a.id)?.status).toBe("superseded");
    expect(repo.getCurrentForCompany("c1")).toBeNull();

    const b = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "second",
      roles,
      agents,
    });
    repo.markApproved(b.id);
    expect(repo.getById(b.id)?.status).toBe("approved");

    const c = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "third",
      roles,
      agents,
    });
    repo.markRejected(c.id, "not now");
    expect(repo.getById(c.id)?.status).toBe("rejected");
    expect(repo.getById(c.id)?.userFeedback).toBe("not now");
  });
});
