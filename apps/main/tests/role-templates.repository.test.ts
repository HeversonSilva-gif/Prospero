import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0004 } from "../src/db/post-migrations/0004.js";
import { createRoleTemplatesRepository } from "../src/agents/role-templates-repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
  runPostMigration0004(db);
  return { db, repo: createRoleTemplatesRepository(db) };
};

describe("RoleTemplatesRepository", () => {
  it("listAll returns the 5 seeded roles", () => {
    const { repo } = setup();
    const roles = repo.listAll();
    expect(roles.map((r) => r.id).sort()).toEqual([
      "role-ceo",
      "role-designer",
      "role-engineer",
      "role-pm",
      "role-qa",
    ]);
  });

  it("each role has parsed capabilities + default_model + icon", () => {
    const { repo } = setup();
    const eng = repo.listAll().find((r) => r.id === "role-engineer")!;
    expect(eng.defaultCapabilities).toContain("shell");
    expect(eng.defaultModel).toBe("claude-sonnet-4-6");
    expect(eng.icon).toBe("👨‍💻");
  });

  it("getById returns null for unknown id", () => {
    const { repo } = setup();
    expect(repo.getById("role-doesnt-exist")).toBeNull();
  });

  it("agentsUsing returns agents matching template_id", () => {
    const { db, repo } = setup();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, template_id, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1', 'c1', 'Alice', 'Engineer', 'role-engineer', 'sp', '[]', '[]', 'supervised', 0, 'idle', 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, template_id, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a2', 'c1', 'Bob', 'Engineer', 'role-engineer', 'sp', '[]', '[]', 'supervised', 0, 'idle', 0, 0)`,
    ).run();
    const list = repo.agentsUsing("role-engineer");
    expect(list.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
    expect(list.map((a) => a.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("agentsUsing returns empty when no agents use the role", () => {
    const { repo } = setup();
    expect(repo.agentsUsing("role-designer")).toEqual([]);
  });
});
