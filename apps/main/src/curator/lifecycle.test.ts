import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { nextLifecycleState, STALE_DAYS, ARCHIVE_DAYS, runLifecyclePass } from "./lifecycle.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY;

describe("nextLifecycleState", () => {
  it("active when used within STALE_DAYS", () => {
    expect(nextLifecycleState(NOW - (STALE_DAYS - 1) * DAY, NOW)).toBe("active");
  });
  it("stale at exactly STALE_DAYS", () => {
    expect(nextLifecycleState(NOW - STALE_DAYS * DAY, NOW)).toBe("stale");
  });
  it("stale between STALE_DAYS and ARCHIVE_DAYS", () => {
    expect(nextLifecycleState(NOW - (ARCHIVE_DAYS - 1) * DAY, NOW)).toBe("stale");
  });
  it("archived at exactly ARCHIVE_DAYS", () => {
    expect(nextLifecycleState(NOW - ARCHIVE_DAYS * DAY, NOW)).toBe("archived");
  });
});

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1', 'c1', 'A', 'dev', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run();
  return db;
};

const oldSkill = (
  db: Database.Database,
  name: string,
  ageDays: number,
  promoted = false,
): string => {
  const repo = createSkillsRepository(db);
  const s = repo.create({
    companyId: "c1",
    agentId: promoted ? null : "a1",
    name,
    bodyPath: `/p/${name}`,
    description: "d",
    source: "user_authored",
  });
  const last = NOW - ageDays * DAY;
  db.prepare("UPDATE skills SET last_used = ?, promoted = ? WHERE id = ?").run(
    last,
    promoted ? 1 : 0,
    s.id,
  );
  return s.id;
};

describe("runLifecyclePass", () => {
  it("moves an unused private skill to stale and posts one notice", () => {
    const db = seed();
    const id = oldSkill(db, "fades", 40);
    const r = runLifecyclePass(db, NOW);
    expect(r.toStale).toBe(1);
    expect(createSkillsRepository(db).getById(id)!.lifecycleState).toBe("stale");
    const notices = db
      .prepare("SELECT COUNT(*) n FROM inbox_items WHERE kind='memory_review_needed'")
      .get() as { n: number };
    expect(notices.n).toBe(1);
    const r2 = runLifecyclePass(db, NOW);
    expect(r2.toStale).toBe(0);
  });

  it("archives an unused private skill past ARCHIVE_DAYS", () => {
    const db = seed();
    const id = oldSkill(db, "old", 100);
    const r = runLifecyclePass(db, NOW);
    expect(r.toArchived).toBe(1);
    expect(createSkillsRepository(db).getById(id)!.lifecycleState).toBe("archived");
  });

  it("does NOT auto-archive a promoted skill (goes stale instead)", () => {
    const db = seed();
    const id = oldSkill(db, "shared", 100, true);
    const r = runLifecyclePass(db, NOW);
    expect(r.toArchived).toBe(0);
    expect(createSkillsRepository(db).getById(id)!.lifecycleState).toBe("stale");
  });
});
