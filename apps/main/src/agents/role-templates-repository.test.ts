import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { runPostMigration0004 } from "../db/post-migrations/0004.js";
import { runPostMigration0007 } from "../db/post-migrations/0007.js";
import { createRoleTemplatesRepository } from "./role-templates-repository.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  runPostMigration0004(db);
  runPostMigration0007(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

describe("roleTemplatesRepository CRUD", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("create persists a role with a role_ id and timestamps", () => {
    const repo = createRoleTemplatesRepository(db);
    const role = repo.create({
      name: "Traffic Manager",
      description: "Runs paid acquisition campaigns.",
      icon: "📈",
      defaultModel: "claude-sonnet-4-6",
      defaultCapabilities: ["web", "issues", "chat"],
    });
    expect(role.id).toMatch(/^role_/);
    expect(role.name).toBe("Traffic Manager");
    expect(role.isSeedExample).toBe(false);
    expect(role.createdAt).toBeGreaterThan(0);
    expect(role.defaultSystemPrompt).toContain("Traffic Manager");
    expect(repo.getById(role.id)).not.toBeNull();
  });

  it("update merges a patch and bumps updated_at", () => {
    const repo = createRoleTemplatesRepository(db);
    const role = repo.create({
      name: "Analyst",
      description: "old",
      icon: null,
      defaultModel: "claude-sonnet-4-6",
      defaultCapabilities: ["chat"],
    });
    const updated = repo.update(role.id, {
      description: "new",
      defaultCapabilities: ["chat", "web"],
    });
    expect(updated.description).toBe("new");
    expect(updated.defaultCapabilities).toEqual(["chat", "web"]);
    expect(updated.name).toBe("Analyst");
    expect(updated.updatedAt).toBeGreaterThanOrEqual(role.updatedAt);
  });

  it("clone copies a role under a new id with a (copy) name", () => {
    const repo = createRoleTemplatesRepository(db);
    const clone = repo.clone("role-engineer");
    expect(clone.id).not.toBe("role-engineer");
    expect(clone.id).toMatch(/^role_/);
    expect(clone.name).toBe("Engineer (copy)");
    expect(clone.isSeedExample).toBe(false);
    expect(clone.defaultCapabilities).toEqual(repo.getById("role-engineer")!.defaultCapabilities);
  });

  it("delete removes a role with no agents", () => {
    const repo = createRoleTemplatesRepository(db);
    const role = repo.create({
      name: "Temp",
      description: "d",
      icon: null,
      defaultModel: "claude-sonnet-4-6",
      defaultCapabilities: ["chat"],
    });
    repo.delete(role.id);
    expect(repo.getById(role.id)).toBeNull();
  });

  it("delete throws when agents still use the role", () => {
    const repo = createRoleTemplatesRepository(db);
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
         allowed_projects_json, mode, always_on, status, created_at, updated_at, template_id)
       VALUES ('a1','c1','Bob','engineer','sp','[]','[]','supervised',0,'idle',0,0,'role-engineer')`,
    ).run();
    expect(() => repo.delete("role-engineer")).toThrow(/in use/i);
    expect(repo.getById("role-engineer")).not.toBeNull();
  });
});
