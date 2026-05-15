import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createSkillsRepository } from "./skills-repository.js";

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

describe("skillsRepository", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("create persists a skill with a skill_ id and version 1", () => {
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy-runbook",
      bodyPath: "/x/SKILL.md",
      description: "How to deploy",
      source: "user_authored",
    });
    expect(s.id).toMatch(/^skill_/);
    expect(s.version).toBe(1);
    expect(s.trust).toBe(0.5);
    expect(s.promoted).toBe(false);
  });

  it("getByName resolves within the agent scope", () => {
    const repo = createSkillsRepository(db);
    repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    expect(repo.getByName("c1", "a1", "x")?.name).toBe("x");
    expect(repo.getByName("c1", null, "x")).toBeNull();
  });

  it("listCompanyShared returns only agent_id IS NULL skills", () => {
    const repo = createSkillsRepository(db);
    repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "priv",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.create({
      companyId: "c1",
      agentId: null,
      name: "shared",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    expect(repo.listCompanyShared("c1").map((s) => s.name)).toEqual(["shared"]);
  });

  it("listForRole matches applies_to_role on company-shared skills", () => {
    const repo = createSkillsRepository(db);
    repo.create({
      companyId: "c1",
      agentId: null,
      name: "eng-skill",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
      appliesToRole: "engineer",
    });
    expect(repo.listForRole("c1", "engineer").map((s) => s.name)).toEqual(["eng-skill"]);
    expect(repo.listForRole("c1", "designer").length).toBe(0);
  });

  it("update bumps the version", () => {
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    const updated = repo.update(s.id, { description: "better" });
    expect(updated.version).toBe(2);
    expect(updated.description).toBe("better");
  });

  it("recordUse increments use_count and sets last_used", () => {
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.recordUse(s.id);
    const after = repo.getById(s.id);
    expect(after?.useCount).toBe(1);
    expect(after?.lastUsed).not.toBeNull();
  });

  it("softDelete hides a skill and frees its name for re-creation", () => {
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.softDelete(s.id);
    expect(repo.listByAgent("a1").length).toBe(0);
    // unique index is partial (WHERE soft_deleted = 0) — same name re-creatable
    expect(() =>
      repo.create({
        companyId: "c1",
        agentId: "a1",
        name: "x",
        bodyPath: "p",
        description: "d2",
        source: "user_authored",
      }),
    ).not.toThrow();
  });
});
