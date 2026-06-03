import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectTrackRecord,
  DEFAULT_WINDOW_MS,
  VERIFIED_OUTCOME_WINDOW_MS,
} from "./track-record.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setup = () => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    now,
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(now, now);
  return { db, now };
};

const seedGoal = (
  db: Database.Database,
  goalId: string,
  ownerAgentId: string,
  status: string,
  now: number,
) => {
  db.prepare(
    "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(goalId, "c1", ownerAgentId, "g", "x", "task", status, now, now);
};

const seedCriterion = (
  db: Database.Database,
  cid: string,
  goalId: string,
  status: string,
  attempts: number,
  updatedAt?: number,
) => {
  const t = updatedAt ?? Date.now();
  db.prepare(
    "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(cid, goalId, 0, "x", "deterministic", status, attempts, t, t);
};

describe("collectTrackRecord", () => {
  it("returns all-zeros for a brand-new agent", () => {
    const { db } = setup();
    const r = collectTrackRecord(db, "a1");
    expect(r.verifiedOutcomes).toBe(0);
    expect(r.iscFirstPassRate).toBe(0);
    expect(r.verificationFailures).toBe(0);
    expect(r.demotedInWindow).toBe(false);
    expect(r.approvalsAccepted).toBe(0);
    expect(r.approvalsRejected).toBe(0);
  });

  it("counts goals reached achieved owned by the agent", () => {
    const { db, now } = setup();
    seedGoal(db, "g1", "a1", "achieved", now);
    seedGoal(db, "g2", "a1", "in_progress", now);
    seedGoal(db, "g3", "a1", "achieved", now);
    const r = collectTrackRecord(db, "a1");
    expect(r.verifiedOutcomes).toBe(2);
  });

  it("excludes achievements older than the long verified-outcome window (#12)", () => {
    const { db } = setup();
    const now = Date.now();
    seedGoal(db, "g-recent", "a1", "achieved", now - 10 * 24 * 60 * 60 * 1000);
    seedGoal(db, "g-old", "a1", "achieved", now - VERIFIED_OUTCOME_WINDOW_MS - 60_000);
    const r = collectTrackRecord(db, "a1", { now });
    expect(r.verifiedOutcomes).toBe(1); // only the recent achievement counts
  });

  it("computes iscFirstPassRate from goal_criteria across the agent's goals", () => {
    const { db, now } = setup();
    seedGoal(db, "g1", "a1", "achieved", now);
    seedCriterion(db, "c1", "g1", "passed", 1);
    seedCriterion(db, "c2", "g1", "passed", 3);
    seedCriterion(db, "c3", "g1", "failed", 2, now); // failed counts as terminal too
    const r = collectTrackRecord(db, "a1");
    // 1 first-pass / 3 terminal
    expect(r.iscFirstPassRate).toBeCloseTo(1 / 3, 5);
  });

  it("excludes ISC results outside the window so old flakiness can't block autonomo forever", () => {
    const { db, now } = setup();
    seedGoal(db, "g1", "a1", "achieved", now);
    // Old flaky failure (>30d ago) must NOT stay in the denominator forever.
    seedCriterion(db, "cold", "g1", "failed", 2, now - DEFAULT_WINDOW_MS - 60_000);
    seedCriterion(db, "cnew", "g1", "passed", 1, now); // recent clean first pass
    const r = collectTrackRecord(db, "a1", { now });
    expect(r.iscFirstPassRate).toBe(1); // only the recent criterion counts
  });

  it("excludes judgment criteria from the first-pass rate (they never reach attempts=1)", () => {
    const { db, now } = setup();
    seedGoal(db, "g1", "a1", "achieved", now);
    seedCriterion(db, "cd", "g1", "passed", 1, now); // deterministic first pass
    // Judgment criterion: passed via setJudgment, attempts stays 0 → it would
    // otherwise sit in the denominator but never the numerator, depressing the rate.
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, created_at, updated_at) VALUES ('cj','g1',1,'on brand','judgment','passed',0,?,?)",
    ).run(now, now);
    const r = collectTrackRecord(db, "a1", { now });
    expect(r.iscFirstPassRate).toBe(1); // judgment excluded; only the deterministic pass counts
  });

  it("counts verification failures from goal_criteria with status=failed in window", () => {
    const { db, now } = setup();
    seedGoal(db, "g1", "a1", "in_progress", now);
    seedCriterion(db, "c1", "g1", "failed", 1, now);
    seedCriterion(db, "c2", "g1", "failed", 2, now);
    seedCriterion(db, "c3", "g1", "passed", 1, now);
    const r = collectTrackRecord(db, "a1");
    expect(r.verificationFailures).toBe(2);
  });

  it("counts demotedInWindow from trust_events inside the window", () => {
    const { db, now } = setup();
    db.prepare(
      "INSERT INTO trust_events (id, agent_id, kind, from_tier, to_tier, reason, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("e1", "a1", "demoted", "confiavel", "novato", "x", now - 1000);
    const r = collectTrackRecord(db, "a1");
    expect(r.demotedInWindow).toBe(true);
  });

  it("ignores demotions outside the window", () => {
    const { db, now } = setup();
    db.prepare(
      "INSERT INTO trust_events (id, agent_id, kind, from_tier, to_tier, reason, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("e1", "a1", "demoted", "confiavel", "novato", "x", now - DEFAULT_WINDOW_MS - 60_000);
    const r = collectTrackRecord(db, "a1");
    expect(r.demotedInWindow).toBe(false);
  });
});
