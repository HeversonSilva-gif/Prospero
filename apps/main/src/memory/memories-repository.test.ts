import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createMemoriesRepository } from "./memories-repository.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a2','c1','Design','designer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  return db;
};

describe("memoriesRepository", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("create persists a memory with defaults and an mem_ id", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "always lint" });
    expect(m.id).toMatch(/^mem_/);
    expect(m.importance).toBe(0.5);
    expect(m.trust).toBe(0.5);
    expect(m.pinned).toBe(false);
    expect(m.softDeleted).toBe(false);
    expect(repo.getById(m.id)?.body).toBe("always lint");
  });

  it("listByAgent returns agent-private rows ordered by importance desc", () => {
    const repo = createMemoriesRepository(db);
    repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "low", importance: 0.2 });
    repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "high", importance: 0.9 });
    const rows = repo.listByAgent("a1");
    expect(rows.map((r) => r.body)).toEqual(["high", "low"]);
  });

  it("listCompanyWide returns only agent_id IS NULL rows", () => {
    const repo = createMemoriesRepository(db);
    repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "private" });
    repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "company" });
    expect(repo.listCompanyWide("c1").map((r) => r.body)).toEqual(["company"]);
  });

  it("listForRole matches applies_to_role on company-wide rows", () => {
    const repo = createMemoriesRepository(db);
    repo.create({
      companyId: "c1",
      agentId: null,
      kind: "rule",
      body: "eng rule",
      appliesToRole: "engineer",
    });
    repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "global" });
    expect(repo.listForRole("c1", "engineer").map((r) => r.body)).toEqual(["eng rule"]);
  });

  it("update changes the body and keeps FTS in sync", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "old text" });
    repo.update(m.id, { body: "fresh docker text" });
    expect(repo.getById(m.id)?.body).toBe("fresh docker text");
    expect(repo.search("docker").map((r) => r.id)).toEqual([m.id]);
    expect(repo.search("old").length).toBe(0);
  });

  it("softDelete hides a row from listByAgent and search", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "docker note" });
    repo.softDelete(m.id);
    expect(repo.listByAgent("a1").length).toBe(0);
    expect(repo.search("docker").length).toBe(0);
  });

  it("search filters by agentId and respects limit", () => {
    const repo = createMemoriesRepository(db);
    repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "kafka tuning notes" });
    repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "kafka company rule" });
    expect(repo.search("kafka", { agentId: "a1" }).length).toBe(1);
    expect(repo.search("kafka", { limit: 1 }).length).toBe(1);
  });

  it("search scopeToAgent returns company-wide rows AND the agent's own rows", () => {
    const repo = createMemoriesRepository(db);
    repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "redis private note" });
    repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "redis company rule" });
    repo.create({ companyId: "c1", agentId: "a2", kind: "rule", body: "redis other agent" });

    const hits = repo.search("redis", { scopeToAgent: "a1" });
    const bodies = hits.map((m) => m.body);
    expect(bodies).toContain("redis private note");
    expect(bodies).toContain("redis company rule");
    expect(bodies).not.toContain("redis other agent");
  });

  it("search scopeToAgent does NOT leak another agent's private rows", () => {
    const repo = createMemoriesRepository(db);
    repo.create({ companyId: "c1", agentId: "a2", kind: "rule", body: "postgres secret tip" });
    repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "postgres global rule" });

    const hits = repo.search("postgres", { scopeToAgent: "a1" });
    const bodies = hits.map((m) => m.body);
    expect(bodies).not.toContain("postgres secret tip");
    expect(bodies).toContain("postgres global rule");
  });

  it("search without scopeToAgent retains existing behaviour (returns all rows for the company)", () => {
    const repo = createMemoriesRepository(db);
    repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "nginx agent rule" });
    repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "nginx company rule" });
    repo.create({ companyId: "c1", agentId: "a2", kind: "rule", body: "nginx other rule" });

    // No scopeToAgent → all three rows returned
    const hits = repo.search("nginx", { companyId: "c1" });
    expect(hits.length).toBe(3);
  });
});

describe("memories-repository — recordAccess", () => {
  it("recordAccess bumps last_accessed and access_count for the given ids", () => {
    const db = newDb();
    const repo = createMemoriesRepository(db);
    const m1 = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "note one" });
    const m2 = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "note two" });

    expect(m1.lastAccessed).toBeNull();
    expect(m1.accessCount).toBe(0);

    const before = Date.now();
    repo.recordAccess([m1.id, m2.id]);
    const after = Date.now();

    const updated1 = repo.getById(m1.id)!;
    const updated2 = repo.getById(m2.id)!;

    expect(updated1.lastAccessed).toBeGreaterThanOrEqual(before);
    expect(updated1.lastAccessed).toBeLessThanOrEqual(after);
    expect(updated1.accessCount).toBe(1);

    expect(updated2.lastAccessed).toBeGreaterThanOrEqual(before);
    expect(updated2.lastAccessed).toBeLessThanOrEqual(after);
    expect(updated2.accessCount).toBe(1);
  });

  it("recordAccess does not touch rows that are NOT in the ids list", () => {
    const db = newDb();
    const repo = createMemoriesRepository(db);
    const m1 = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "touched" });
    const m2 = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "untouched" });

    repo.recordAccess([m1.id]);

    const untouched = repo.getById(m2.id)!;
    expect(untouched.lastAccessed).toBeNull();
    expect(untouched.accessCount).toBe(0);
  });

  it("recordAccess on an empty array is a no-op", () => {
    const db = newDb();
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "noop test" });

    // Must not throw
    repo.recordAccess([]);

    const unchanged = repo.getById(m.id)!;
    expect(unchanged.lastAccessed).toBeNull();
    expect(unchanged.accessCount).toBe(0);
  });

  it("calling recordAccess twice increments access_count to 2", () => {
    const db = newDb();
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "double access" });

    repo.recordAccess([m.id]);
    repo.recordAccess([m.id]);

    const updated = repo.getById(m.id)!;
    expect(updated.accessCount).toBe(2);
  });
});

describe("memories-repository — decay support", () => {
  it("listDecayCandidates returns active, non-pinned, non-identity memories across companies", () => {
    const db = newDb();
    const repo = createMemoriesRepository(db);
    const keep = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "decays" });
    repo.create({ companyId: "c1", agentId: null, kind: "identity", body: "exempt" });
    const pinned = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "pinned" });
    repo.update(pinned.id, { pinned: true });
    const deleted = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "gone" });
    repo.softDelete(deleted.id);

    const ids = repo.listDecayCandidates().map((m) => m.id);
    expect(ids).toEqual([keep.id]);
  });

  it("bumpTrust clamps the result to [0, 1]", () => {
    const db = newDb();
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "x" });
    expect(repo.bumpTrust(m.id, -0.1).trust).toBeCloseTo(0.4, 5);
    expect(repo.bumpTrust(m.id, -1).trust).toBe(0);
    expect(repo.bumpTrust(m.id, 5).trust).toBe(1);
  });
});
