import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createMemoriesRepository } from "./memories-repository.js";
import { createSkillsRepository } from "./skills-repository.js";
import { runMemoryMaintenance } from "./maintenance.js";

const DAY = 24 * 60 * 60 * 1000;

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

const setLastRun = (db: Database.Database, ms: number): void => {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('memory_maintenance_last_run', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(ms));
};

describe("runMemoryMaintenance", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
  });

  it("does not decay on the very first run — it only records the baseline", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "x" });
    const result = runMemoryMaintenance(db, 100 * DAY);
    expect(result.ran).toBe(true);
    expect(result.decayed).toBe(0);
    expect(repo.getById(m.id)?.importance).toBe(0.5);
  });

  it("skips the run when the last pass was under 20 hours ago", () => {
    setLastRun(db, 100 * DAY);
    const result = runMemoryMaintenance(db, 100 * DAY + 60 * 60 * 1000);
    expect(result.ran).toBe(false);
  });

  it("decays importance by the elapsed time since the last run", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "x" });
    setLastRun(db, 0);
    runMemoryMaintenance(db, 90 * DAY);
    expect(repo.getById(m.id)?.importance).toBeCloseTo(0.25, 2);
  });

  it("does not decay pinned or identity memories", () => {
    const repo = createMemoriesRepository(db);
    const pinned = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "p" });
    repo.update(pinned.id, { pinned: true });
    const identity = repo.create({ companyId: "c1", agentId: null, kind: "identity", body: "i" });
    setLastRun(db, 0);
    runMemoryMaintenance(db, 900 * DAY);
    expect(repo.getById(pinned.id)?.importance).toBe(0.5);
    expect(repo.getById(identity.id)?.importance).toBe(0.5);
  });

  it("posts a memory_review_needed notice when a memory crosses into the danger zone", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "fading note" });
    repo.update(m.id, { importance: 0.3 });
    // Force created_at old so the memory is stale but importance after decay
    // (~0.15 at 90 days) stays above the 0.1 prune line.
    db.prepare("UPDATE memories SET created_at = 0 WHERE id = ?").run(m.id);
    setLastRun(db, 0);
    const result = runMemoryMaintenance(db, 90 * DAY);
    expect(result.warned).toBe(1);
    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE company_id = 'c1'")
      .all() as Array<{ kind: string }>;
    expect(inbox).toEqual([{ kind: "memory_review_needed" }]);
  });

  it("prunes a memory whose decayed importance is below 0.1 and is stale", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "dead" });
    repo.update(m.id, { importance: 0.12 });
    // Force created_at = 0 so the memory is stale (age >> 30 days at now=90*DAY).
    db.prepare("UPDATE memories SET created_at = 0 WHERE id = ?").run(m.id);
    setLastRun(db, 0);
    const result = runMemoryMaintenance(db, 90 * DAY);
    expect(result.pruned).toBe(1);
    // getById does NOT filter by soft_deleted, so we check the flag directly.
    const row = db.prepare("SELECT soft_deleted FROM memories WHERE id = ?").get(m.id) as {
      soft_deleted: number;
    };
    expect(row.soft_deleted).toBe(1);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM inbox_items").get() as { n: number }).n;
    expect(n).toBe(1);
  });
});

describe("runMemoryMaintenance — skill purge", () => {
  const seedWithAgent = (): Database.Database => {
    const db = seed();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
         allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
    ).run();
    return db;
  };

  it("hard-deletes skills soft-deleted more than 30 days ago, keeps recent ones", () => {
    const db = seedWithAgent();
    const repo = createSkillsRepository(db);
    const mk = (name: string) =>
      repo.create({
        companyId: "c1",
        agentId: "a1",
        name,
        bodyPath: "p",
        description: "d",
        source: "user_authored",
      });
    const old = mk("old");
    const recent = mk("recent");
    repo.softDelete(old.id, 0); // soft-deleted at t=0
    repo.softDelete(recent.id, 100 * DAY); // soft-deleted "recently"
    setLastRun(db, 0);

    // now = 100 days: `old` is 100d stale (>30d), `recent` is 0d stale
    const result = runMemoryMaintenance(db, 100 * DAY);
    expect(result.purgedSkills).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM skills WHERE id = ?").get(old.id) as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM skills WHERE id = ?").get(recent.id) as { n: number })
        .n,
    ).toBe(1);
  });

  it("never purges a live (non-soft-deleted) skill", () => {
    const db = seedWithAgent();
    const repo = createSkillsRepository(db);
    const live = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "live",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    setLastRun(db, 0);
    const result = runMemoryMaintenance(db, 100 * DAY);
    expect(result.purgedSkills).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM skills WHERE id = ?").get(live.id) as { n: number }).n,
    ).toBe(1);
  });

  it("never purges a skill whose soft_deleted_at is NULL (pre-migration row)", () => {
    const db = seedWithAgent();
    const repo = createSkillsRepository(db);
    const legacy = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "legacy",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    // Simulate a row soft-deleted before migration 0023 added soft_deleted_at.
    db.prepare("UPDATE skills SET soft_deleted = 1, soft_deleted_at = NULL WHERE id = ?").run(
      legacy.id,
    );
    setLastRun(db, 0);
    const result = runMemoryMaintenance(db, 100 * DAY);
    expect(result.purgedSkills).toBe(0);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM skills WHERE id = ?").get(legacy.id) as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });
});
