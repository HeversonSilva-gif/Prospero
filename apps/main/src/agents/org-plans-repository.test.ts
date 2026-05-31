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

  it("insert + getById round-trips roles and agents (starts as critiquing)", () => {
    const repo = createOrgPlansRepository(db);
    const plan = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "a plan",
      roles,
      agents,
    });
    expect(plan.id).toMatch(/^orgplan_/);
    expect(plan.status).toBe("critiquing");
    const got = repo.getById(plan.id);
    expect(got?.roles[0]?.name).toBe("Manager");
    expect(got?.agents[0]?.reportsToIndex).toBe("CEO");
  });

  it("getCurrentForCompany returns null for a plan still in critiquing", () => {
    const repo = createOrgPlansRepository(db);
    repo.insert({ companyId: "c1", proposedByAgentId: "ceo", summary: "s", roles, agents });
    expect(repo.getCurrentForCompany("c1")).toBeNull();
  });

  it("getCurrentForCompany returns the plan after markProposed flips it", () => {
    const repo = createOrgPlansRepository(db);
    const plan = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "a plan",
      roles,
      agents,
    });
    repo.markProposed(plan.id);
    expect(repo.getCurrentForCompany("c1")?.id).toBe(plan.id);
  });

  it("markProposed flips critiquing→proposed", () => {
    const repo = createOrgPlansRepository(db);
    const plan = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "s",
      roles,
      agents,
    });
    expect(repo.getById(plan.id)?.status).toBe("critiquing");
    repo.markProposed(plan.id);
    expect(repo.getById(plan.id)?.status).toBe("proposed");
  });

  it("markProposed is a no-op on a plan that is already proposed", () => {
    const repo = createOrgPlansRepository(db);
    const plan = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "s",
      roles,
      agents,
    });
    repo.markProposed(plan.id);
    expect(repo.getById(plan.id)?.status).toBe("proposed");
    // calling again must not throw and must leave status unchanged
    repo.markProposed(plan.id);
    expect(repo.getById(plan.id)?.status).toBe("proposed");
  });

  it("markProposed is a no-op on a plan with a terminal status", () => {
    const repo = createOrgPlansRepository(db);
    const plan = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "s",
      roles,
      agents,
    });
    repo.markApproved(plan.id);
    repo.markProposed(plan.id); // must not flip an approved plan
    expect(repo.getById(plan.id)?.status).toBe("approved");
  });

  it("supersedeActiveForCompany supersedes both proposed and critiquing plans", () => {
    const repo = createOrgPlansRepository(db);
    const critiquing = repo.insert({
      companyId: "c1",
      proposedByAgentId: "ceo",
      summary: "critiquing plan",
      roles,
      agents,
    });
    // insert a second plan and promote it to proposed manually via raw SQL
    // (repo.insert always starts as critiquing — use raw sql to seed a 'proposed' row)
    db.prepare(
      `INSERT INTO org_plans
         (id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
          status, proposed_at)
       VALUES ('manual_proposed','c1','ceo','proposed plan','[]','[]','proposed',1)`,
    ).run();

    repo.supersedeActiveForCompany("c1");

    expect(repo.getById(critiquing.id)?.status).toBe("superseded");
    expect(repo.getById("manual_proposed")?.status).toBe("superseded");
    // the SQL stamps decided_at on each superseded row — lock it in
    expect(repo.getById(critiquing.id)?.decidedAt).not.toBeNull();
    expect(repo.getById("manual_proposed")?.decidedAt).not.toBeNull();
  });

  it("supersedeActiveForCompany leaves approved/rejected plans untouched", () => {
    const repo = createOrgPlansRepository(db);
    db.prepare(
      `INSERT INTO org_plans
         (id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
          status, proposed_at)
       VALUES ('ap','c1','ceo','approved','[]','[]','approved',0)`,
    ).run();
    db.prepare(
      `INSERT INTO org_plans
         (id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
          status, proposed_at)
       VALUES ('rj','c1','ceo','rejected','[]','[]','rejected',1)`,
    ).run();

    repo.supersedeActiveForCompany("c1");

    expect(repo.getById("ap")?.status).toBe("approved");
    expect(repo.getById("rj")?.status).toBe("rejected");
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
    // plan was never proposed so getCurrentForCompany should already be null
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
