import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { runCuratorPass } from "./pass.js";

const DAY = 24 * 60 * 60 * 1000;
let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  // copy the full agents column set from lifecycle.test.ts if this minimal insert fails:
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1', 'c1', 'A', 'dev', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run();
  // seed 3 skills so the librarian fork threshold is met
  const repo = createSkillsRepository(db);
  repo.create({
    companyId: "c1",
    agentId: "a1",
    name: "skill1",
    bodyPath: "/p/s1",
    description: "d1",
    source: "user_authored",
  });
  repo.create({
    companyId: "c1",
    agentId: "a1",
    name: "skill2",
    bodyPath: "/p/s2",
    description: "d2",
    source: "user_authored",
  });
  repo.create({
    companyId: "c1",
    agentId: "a1",
    name: "skill3",
    bodyPath: "/p/s3",
    description: "d3",
    source: "user_authored",
  });
});

const fork = (): Promise<{
  text: string;
  usage: { input: number; output: number; cacheCreation: number; cacheRead: number };
}> =>
  Promise.resolve({ text: "[]", usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 } });

describe("runCuratorPass", () => {
  it("runs the lifecycle pass every call but throttles the fork to 7 days", async () => {
    let forkCalls = 0;
    const countingFork = (): Promise<{
      text: string;
      usage: { input: number; output: number; cacheCreation: number; cacheRead: number };
    }> => {
      forkCalls++;
      return fork();
    };
    const now = 1000 * DAY;
    await runCuratorPass({ db, now, runDerivation: countingFork, authEnv: () => ({}) });
    expect(forkCalls).toBe(1);
    await runCuratorPass({ db, now: now + DAY, runDerivation: countingFork, authEnv: () => ({}) });
    expect(forkCalls).toBe(1);
    await runCuratorPass({
      db,
      now: now + 8 * DAY,
      runDerivation: countingFork,
      authEnv: () => ({}),
    });
    expect(forkCalls).toBe(2);
  });

  it("broadcasts an inbox update for a company when the librarian creates proposals", async () => {
    const repo = createSkillsRepository(db);
    const s1 = repo.getByName("c1", "a1", "skill1")!.id;
    const archiveFork = (): Promise<{
      text: string;
      usage: { input: number; output: number; cacheCreation: number; cacheRead: number };
    }> =>
      Promise.resolve({
        text: JSON.stringify([{ kind: "archive", sourceSkillIds: [s1], rationale: "stale" }]),
        usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      });
    const broadcasts: string[] = [];
    await runCuratorPass({
      db,
      now: 1000 * DAY,
      runDerivation: archiveFork,
      authEnv: () => ({}),
      broadcastInbox: (cid) => broadcasts.push(cid),
    });
    // The librarian created an inbox card for c1 — the renderer only reloads on
    // the broadcast, so it must fire or the proposal is invisible until reload.
    expect(broadcasts).toContain("c1");
  });

  it("dry-run runs the fork but persists nothing and does not advance the throttle", async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('curator_dry_run','1')").run();
    const repo = createSkillsRepository(db);
    repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "a",
      bodyPath: "/p/a",
      description: "d",
      source: "user_authored",
    });
    repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "b",
      bodyPath: "/p/b",
      description: "d",
      source: "user_authored",
    });
    repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "c",
      bodyPath: "/p/c",
      description: "d",
      source: "user_authored",
    });
    const aId = repo.getByName("c1", "a1", "a")!.id;
    const mergeFork = (): Promise<{
      text: string;
      usage: { input: number; output: number; cacheCreation: number; cacheRead: number };
    }> =>
      Promise.resolve({
        text: JSON.stringify([{ kind: "archive", sourceSkillIds: [aId], rationale: "x" }]),
        usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      });
    const now = 1000 * DAY;
    await runCuratorPass({ db, now, runDerivation: mergeFork, authEnv: () => ({}) });
    const props = db.prepare("SELECT COUNT(*) n FROM skill_proposals").get() as { n: number };
    expect(props.n).toBe(0);
    const lastRun = db.prepare("SELECT value FROM settings WHERE key='curator_last_run'").get();
    expect(lastRun).toBeUndefined();
  });
});
