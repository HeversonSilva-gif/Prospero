import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recomputeAgentTrust } from "./engine.js";
import { _setRecorderForTest } from "../activity/index.js";
import { _setInboxForTest } from "../inbox/index.js";
import { createInboxRepository } from "../inbox/repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

const applyMigrations = (db: Database.Database) => {
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
};

const seedCompanyAndAgent = (db: Database.Database, agentId = "a1", companyId = "c1") => {
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    companyId,
    "Acme",
    now,
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES (?, ?, 'A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(agentId, companyId, now, now);
};

const seedAchievedGoals = (db: Database.Database, agentId: string, n: number) => {
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(`g${i}`, "c1", agentId, "g", "x", "task", "achieved", now, now);
  }
};

describe("recomputeAgentTrust", () => {
  let db: Database.Database;
  let recorded: Array<{ action: string }>;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    recorded = [];
    _setRecorderForTest({
      recordActivity: (input) => {
        recorded.push({ action: input.action });
        return { id: "row" } as never;
      },
    });
    _setInboxForTest(createInboxRepository(db));
  });

  afterEach(() => {
    _setRecorderForTest(null);
    _setInboxForTest(null);
    vi.restoreAllMocks();
  });

  it("promotes novato→confiavel after 5 verified outcomes", () => {
    seedCompanyAndAgent(db);
    seedAchievedGoals(db, "a1", 5);
    const result = recomputeAgentTrust(db, "a1");
    expect(result.applied).toBe("promoted");
    if (result.applied === "promoted") {
      expect(result.newTier).toBe("confiavel");
    }
    const row = db.prepare("SELECT trust_tier FROM agents WHERE id=?").get("a1") as {
      trust_tier: string;
    };
    expect(row.trust_tier).toBe("confiavel");
    expect(db.prepare("SELECT COUNT(*) AS n FROM trust_events").get()).toEqual({ n: 1 });
    expect(recorded.some((r) => r.action === "trust.promoted")).toBe(true);
  });

  it("does not promote when track record is insufficient", () => {
    seedCompanyAndAgent(db);
    seedAchievedGoals(db, "a1", 3);
    const result = recomputeAgentTrust(db, "a1");
    expect(result.applied).toBe("none");
    expect(db.prepare("SELECT COUNT(*) AS n FROM trust_events").get()).toEqual({ n: 0 });
    expect(recorded).toHaveLength(0);
  });

  it("suggests confiavel→autonomo via inbox; does NOT auto-promote", () => {
    seedCompanyAndAgent(db);
    seedAchievedGoals(db, "a1", 15);
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, created_at, updated_at) VALUES ('c1','g0',0,'x','deterministic','passed',1,?,?)",
    ).run(Date.now(), Date.now());
    db.prepare("UPDATE agents SET trust_tier='confiavel' WHERE id=?").run("a1");

    const result = recomputeAgentTrust(db, "a1");

    expect(result.applied).toBe("suggested");
    const stillRow = db.prepare("SELECT trust_tier FROM agents WHERE id=?").get("a1") as {
      trust_tier: string;
    };
    expect(stillRow.trust_tier).toBe("confiavel"); // not auto-promoted

    const events = db.prepare("SELECT kind FROM trust_events WHERE agent_id=?").all("a1") as Array<{
      kind: string;
    }>;
    expect(events.map((e) => e.kind)).toContain("promotion_suggested");

    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE kind=?")
      .all("trust_promotion_suggested") as Array<{ kind: string }>;
    expect(inbox).toHaveLength(1);

    expect(recorded.some((r) => r.action === "trust.promotion_suggested")).toBe(true);
  });

  it("demotes autonomo→novato on a verification failure and reverts mode=supervised", () => {
    seedCompanyAndAgent(db);
    db.prepare("UPDATE agents SET trust_tier='autonomo', mode='auto' WHERE id=?").run("a1");
    seedAchievedGoals(db, "a1", 15);
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, created_at, updated_at) VALUES ('c1','g0',0,'x','deterministic','failed',1,?,?)",
    ).run(Date.now(), Date.now());

    const result = recomputeAgentTrust(db, "a1");

    expect(result.applied).toBe("demoted");
    const row = db.prepare("SELECT trust_tier, mode FROM agents WHERE id=?").get("a1") as {
      trust_tier: string;
      mode: string;
    };
    expect(row.trust_tier).toBe("novato");
    expect(row.mode).toBe("supervised");
    expect(recorded.some((r) => r.action === "trust.demoted")).toBe(true);
  });

  it("demotion from confiavel does NOT touch agents.mode", () => {
    seedCompanyAndAgent(db);
    db.prepare("UPDATE agents SET trust_tier='confiavel', mode='supervised' WHERE id=?").run("a1");
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES ('g0','c1','a1','g','x','task','in_progress',?,?)",
    ).run(Date.now(), Date.now());
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, created_at, updated_at) VALUES ('c1','g0',0,'x','deterministic','failed',1,?,?)",
    ).run(Date.now(), Date.now());

    const result = recomputeAgentTrust(db, "a1");

    expect(result.applied).toBe("demoted");
    const row = db.prepare("SELECT trust_tier, mode FROM agents WHERE id=?").get("a1") as {
      trust_tier: string;
      mode: string;
    };
    expect(row.trust_tier).toBe("novato");
    expect(row.mode).toBe("supervised");
  });

  it("idempotent — calling twice with the same state produces one event", () => {
    seedCompanyAndAgent(db);
    seedAchievedGoals(db, "a1", 5);
    recomputeAgentTrust(db, "a1");
    recomputeAgentTrust(db, "a1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM trust_events").get()).toEqual({ n: 1 });
  });
});
