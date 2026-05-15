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
});
