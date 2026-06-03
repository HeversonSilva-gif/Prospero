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

const seed = newDb;

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

  it("listSharedForRole returns role-global + this role's skills, not other roles' (#13)", () => {
    const repo = createSkillsRepository(db);
    const mk = (name: string, appliesToRole: string | null): void => {
      repo.create({
        companyId: "c1",
        agentId: null,
        name,
        bodyPath: "p",
        description: "d",
        source: "user_authored",
        ...(appliesToRole !== null ? { appliesToRole } : {}),
      });
    };
    mk("global", null); // applies to everyone
    mk("eng-only", "engineer"); // engineer-scoped
    mk("design-only", "designer"); // another role — must NOT leak
    const eng = repo
      .listSharedForRole("c1", "engineer")
      .map((s) => s.name)
      .sort();
    expect(eng).toEqual(["eng-only", "global"]);
    // A roleless agent sees only the role-global skills.
    expect(repo.listSharedForRole("c1", null).map((s) => s.name)).toEqual(["global"]);
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

describe("skills-repository listCompanyGlobal + promote", () => {
  it("listCompanyGlobal returns only role-unscoped company-shared skills", () => {
    const db = seed();
    const skills = createSkillsRepository(db);
    skills.create({
      companyId: "c1",
      agentId: null,
      name: "global-skill",
      bodyPath: "p1",
      description: "everyone",
      source: "user_authored",
    });
    skills.create({
      companyId: "c1",
      agentId: null,
      name: "eng-skill",
      bodyPath: "p2",
      description: "engineers",
      source: "user_authored",
      appliesToRole: "engineer",
    });
    expect(skills.listCompanyGlobal("c1").map((s) => s.name)).toEqual(["global-skill"]);
  });

  it("promote flips a private skill to company-shared with a role", () => {
    const db = seed();
    const skills = createSkillsRepository(db);
    const created = skills.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const promoted = skills.promote(created.id, "engineer");
    expect(promoted.agentId).toBeNull();
    expect(promoted.promoted).toBe(true);
    expect(promoted.appliesToRole).toBe("engineer");
    expect(skills.listByAgent("a1")).toHaveLength(0);
    expect(skills.listForRole("c1", "engineer").map((s) => s.name)).toEqual(["deploy"]);
  });

  it("promote with a null role makes the skill company-global", () => {
    const db = seed();
    const skills = createSkillsRepository(db);
    const created = skills.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const promoted = skills.promote(created.id, null);
    expect(promoted.appliesToRole).toBeNull();
    expect(skills.listCompanyGlobal("c1").map((s) => s.name)).toEqual(["x"]);
  });
});

describe("skills-repository — trust feedback", () => {
  it("bumpTrust clamps the result to [0, 1]", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    expect(repo.bumpTrust(s.id, 0.05).trust).toBeCloseTo(0.55, 5);
    expect(repo.bumpTrust(s.id, 5).trust).toBe(1);
    expect(repo.bumpTrust(s.id, -10).trust).toBe(0);
  });
});

describe("skills-repository — soft-delete timestamp", () => {
  it("softDelete records soft_deleted_at", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.softDelete(s.id, 123456);
    const row = db
      .prepare("SELECT soft_deleted, soft_deleted_at FROM skills WHERE id = ?")
      .get(s.id) as { soft_deleted: number; soft_deleted_at: number | null };
    expect(row.soft_deleted).toBe(1);
    expect(row.soft_deleted_at).toBe(123456);
  });

  it("softDelete defaults the timestamp to now", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "y",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    const before = Date.now();
    repo.softDelete(s.id);
    const row = db.prepare("SELECT soft_deleted_at FROM skills WHERE id = ?").get(s.id) as {
      soft_deleted_at: number;
    };
    expect(row.soft_deleted_at).toBeGreaterThanOrEqual(before);
  });
});

describe("curator lifecycle", () => {
  it("recordView increments view_count for each call", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "v-skill",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.recordView([s.id]);
    repo.recordView([s.id]);
    expect(repo.getById(s.id)?.viewCount).toBe(2);
  });

  it("recordPatch increments patch_count", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "p-skill",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.recordPatch(s.id);
    expect(repo.getById(s.id)?.patchCount).toBe(1);
  });

  it("setLifecycleState sets lifecycleState and lifecycleChangedAt", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "ls-skill",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.setLifecycleState(s.id, "archived", 1234);
    const after = repo.getById(s.id);
    expect(after?.lifecycleState).toBe("archived");
    expect(after?.lifecycleChangedAt).toBe(1234);
  });

  it("listByAgent excludes archived skills", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "arc-skill",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.setLifecycleState(s.id, "archived", Date.now());
    expect(repo.listByAgent("a1")).toHaveLength(0);
  });

  it("recordUse on an archived skill revives it to active", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "rev-skill",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.setLifecycleState(s.id, "archived", Date.now());
    repo.recordUse(s.id);
    expect(repo.getById(s.id)?.lifecycleState).toBe("active");
  });

  it("getById still returns an archived skill (reachable on demand)", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "demand-skill",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    repo.setLifecycleState(s.id, "archived", Date.now());
    expect(repo.getById(s.id)?.id).toBe(s.id);
  });
});
