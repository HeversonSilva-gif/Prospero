import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { runLibrarianFork } from "./librarian.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1', 'c1', 'A', 'dev', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run();
});

const addSkill = (name: string) =>
  createSkillsRepository(db).create({
    companyId: "c1",
    agentId: "a1",
    name,
    bodyPath: `/p/${name}`,
    description: `does ${name}`,
    source: "user_authored",
  });

describe("runLibrarianFork", () => {
  it("creates proposals + inbox cards from valid fork output", async () => {
    const s1 = addSkill("alpha");
    const s2 = addSkill("alpha2");
    addSkill("gamma");
    const fork = () =>
      Promise.resolve({
        text: JSON.stringify([
          {
            kind: "merge",
            sourceSkillIds: [s1.id, s2.id],
            name: "alpha-unified",
            description: "d",
            body: "merged body",
            rationale: "overlap",
          },
        ]),
        usage: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0 },
      });
    const r = await runLibrarianFork({
      db,
      companyId: "c1",
      runDerivation: fork,
      authEnv: () => ({}),
      now: () => 1,
    });
    expect(r.proposalsCreated).toBe(1);
    const inbox = db
      .prepare("SELECT COUNT(*) n FROM inbox_items WHERE kind='skill_consolidation_proposed'")
      .get() as { n: number };
    expect(inbox.n).toBe(1);
  });

  it("skips companies with fewer than 3 skills", async () => {
    addSkill("only-one");
    let called = false;
    const fork = () => {
      called = true;
      return Promise.resolve({
        text: "[]",
        usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      });
    };
    const r = await runLibrarianFork({
      db,
      companyId: "c1",
      runDerivation: fork,
      authEnv: () => ({}),
      now: () => 1,
    });
    expect(called).toBe(false);
    expect(r.proposalsCreated).toBe(0);
  });

  it("creates nothing when the fork returns []", async () => {
    addSkill("a");
    addSkill("b");
    addSkill("c");
    const fork = () =>
      Promise.resolve({
        text: "[]",
        usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      });
    const r = await runLibrarianFork({
      db,
      companyId: "c1",
      runDerivation: fork,
      authEnv: () => ({}),
      now: () => 1,
    });
    expect(r.proposalsCreated).toBe(0);
  });
});
