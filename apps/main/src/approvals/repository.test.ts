import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createApprovalsRepository } from "./repository.js";

function db(): Database.Database {
  const d = new Database(":memory:");
  applyMigrations(d);
  d.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',?)").run(Date.now());
  d.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(Date.now(), Date.now());
  return d;
}

describe("ApprovalsRepository — CEO routing", () => {
  let d: Database.Database;
  beforeEach(() => {
    d = db();
  });

  it("setRouted persists routed_to and getById reflects it", () => {
    const repo = createApprovalsRepository(d);
    const apv = repo.create({
      agentId: "a1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "t1" },
    });
    repo.setRouted(apv.id, "ceo");
    expect(repo.getById(apv.id)?.routedTo).toBe("ceo");
  });

  it("setEscalated stamps escalated_at", () => {
    const repo = createApprovalsRepository(d);
    const apv = repo.create({
      agentId: "a1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "x", thread_id: "th1" },
    });
    repo.setEscalated(apv.id);
    expect(repo.getById(apv.id)?.escalatedAt).not.toBeNull();
  });

  it("listPendingRoutedToCeo returns only pending+ceo for the company", () => {
    const repo = createApprovalsRepository(d);
    const a = repo.create({
      agentId: "a1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "t2" },
    });
    repo.setRouted(a.id, "ceo");
    const b = repo.create({
      agentId: "a1",
      kind: "tool_call",
      payload: { tool_name: "Read", tool_input: {}, tool_use_id: "t3" },
    });
    repo.setRouted(b.id, "user");
    const list = repo.listPendingRoutedToCeo("c1");
    expect(list.map((x) => x.id)).toEqual([a.id]);
  });
});

describe("createApprovalsRepository — bounce support", () => {
  it("getById returns bounceCount=0 for freshly created approvals", () => {
    const d = new Database(":memory:");
    applyMigrations(d);
    d.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    d.prepare(
      `INSERT INTO agents
         (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
          mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1', 'c1', 'A', 'engineer', '', '[]', '[]',
               'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
    ).run();
    const repo = createApprovalsRepository(d);
    const apv = repo.create({ agentId: "a1", kind: "tool_call", payload: {} });
    expect(apv.bounceCount).toBe(0);
    d.close();
  });

  it("incrementBounceCount goes 0 -> 1 -> 2", () => {
    const d = new Database(":memory:");
    applyMigrations(d);
    d.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    d.prepare(
      `INSERT INTO agents
         (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
          mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1', 'c1', 'A', 'engineer', '', '[]', '[]',
               'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
    ).run();
    const repo = createApprovalsRepository(d);
    const apv = repo.create({ agentId: "a1", kind: "tool_call", payload: {} });
    repo.incrementBounceCount(apv.id);
    expect(repo.getById(apv.id)?.bounceCount).toBe(1);
    repo.incrementBounceCount(apv.id);
    expect(repo.getById(apv.id)?.bounceCount).toBe(2);
    d.close();
  });

  it("listPendingRoutedToUserForBounce filters by cutoff and routedTo=user", () => {
    const d = new Database(":memory:");
    applyMigrations(d);
    d.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    d.prepare(
      `INSERT INTO agents
         (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
          mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1', 'c1', 'A', 'engineer', '', '[]', '[]',
               'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
    ).run();
    const now = Date.now();
    d.prepare(
      `INSERT INTO approvals (id, agent_id, kind, payload_json, status, created_at, routed_to, bounce_count)
       VALUES ('old-user', 'a1', 'tool_call', '{}', 'pending', ?, 'user', 0),
              ('new-user', 'a1', 'tool_call', '{}', 'pending', ?, 'user', 0),
              ('old-ceo',  'a1', 'tool_call', '{}', 'pending', ?, 'ceo',  0)`,
    ).run(now - 10_000, now, now - 10_000);

    const repo = createApprovalsRepository(d);
    const stuck = repo.listPendingRoutedToUserForBounce(now - 5_000);
    const ids = stuck.map((a) => a.id);
    expect(ids).toContain("old-user");
    expect(ids).not.toContain("new-user");
    expect(ids).not.toContain("old-ceo");
    d.close();
  });
});

describe("createApprovalsRepository — coalescing support (piece #5)", () => {
  it("freshly created approvals have coalescedWith=null", () => {
    const d = new Database(":memory:");
    applyMigrations(d);
    d.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    d.prepare(
      `INSERT INTO agents
         (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
          mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1', 'c1', 'A', 'engineer', '', '[]', '[]',
               'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
    ).run();
    const repo = createApprovalsRepository(d);
    const apv = repo.create({ agentId: "a1", kind: "tool_call", payload: {} });
    expect(apv.coalescedWith).toBeNull();
    d.close();
  });

  it("setCoalescedWith links a follower to the head approval and the read-back reflects it", () => {
    const d = new Database(":memory:");
    applyMigrations(d);
    d.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
    d.prepare(
      `INSERT INTO agents
         (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
          mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1', 'c1', 'A', 'engineer', '', '[]', '[]',
               'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
    ).run();
    const repo = createApprovalsRepository(d);
    const head = repo.create({ agentId: "a1", kind: "tool_call", payload: {} });
    const follower = repo.create({ agentId: "a1", kind: "tool_call", payload: {} });
    repo.setCoalescedWith(follower.id, head.id);
    expect(repo.getById(follower.id)?.coalescedWith).toBe(head.id);
    expect(repo.getById(head.id)?.coalescedWith).toBeNull();
    d.close();
  });
});
