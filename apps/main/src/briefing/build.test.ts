import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBriefing, DEFAULT_WINDOW_MS } from "./build.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const applyMigrations = (db: Database.Database) => {
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
};

const seed = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,?)").run("c1", "Acme", now);
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','Alice','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(now, now);
  return { db, now };
};

describe("buildBriefing", () => {
  it("returns empty buckets and zero cost for a fresh company", () => {
    const { db, now } = seed();
    const b = buildBriefing(db, "c1", null, now);
    expect(b.needsYou).toHaveLength(0);
    expect(b.verified).toHaveLength(0);
    expect(b.failed).toHaveLength(0);
    expect(b.inProgress).toHaveLength(0);
    expect(b.learned).toHaveLength(0);
    expect(b.costCents).toBe(0);
    expect(b.reviewedAt).toBeNull();
  });

  it("collects pending approvals + verification_failed + verification_review + trust_promotion_suggested + agent_unresponsive into needsYou", () => {
    const { db, now } = seed();
    const insert = (kind: string, title: string, id: string) =>
      db
        .prepare(
          "INSERT INTO inbox_items (id, company_id, kind, actor_id, title, preview, requires_action, created_at) VALUES (?,?,?,?,?,?,1,?)",
        )
        .run(id, "c1", kind, "a1", title, null, now - 1000);
    insert("approval", "approval-1", "i1");
    insert("verification_failed", "verif-fail", "i2");
    insert("verification_review", "verif-review", "i3");
    insert("trust_promotion_suggested", "trust-promo", "i4");
    insert("agent_unresponsive", "stuck", "i5");
    // Add a benign kind that should NOT land in needsYou.
    insert("completed", "yay", "i6");

    const b = buildBriefing(db, "c1", null, now);
    const ids = b.needsYou.map((i) => i.id).sort();
    expect(ids).toEqual(["i1", "i2", "i3", "i4", "i5"]);
  });

  it("collects goals achieved since the cursor into verified", () => {
    const { db, now } = seed();
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      "g_old",
      "c1",
      "a1",
      "Old goal",
      "x",
      "task",
      "achieved",
      now - 1000 * 60 * 60 * 48,
      now - 1000 * 60 * 60 * 48,
    );
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("g_new", "c1", "a1", "Recent goal", "x", "task", "achieved", now - 1000, now - 1000);
    // Cursor at 24h ago: only g_new counts.
    const cursor = now - 24 * 60 * 60 * 1000;
    const b = buildBriefing(db, "c1", cursor, now);
    expect(b.verified.map((g) => g.id)).toEqual(["g_new"]);
  });

  it("sums cost_events.cost_cents_estimate since the cursor into costCents", () => {
    const { db, now } = seed();
    db.prepare(
      "INSERT INTO cost_events (id, company_id, agent_id, project_id, issue_id, adapter_name, model, session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_cents_estimate, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "ce1",
      "c1",
      "a1",
      null,
      null,
      "claude-oauth-local",
      "claude-sonnet-4-6",
      null,
      100,
      100,
      0,
      0,
      13,
      now - 500,
    );
    db.prepare(
      "INSERT INTO cost_events (id, company_id, agent_id, project_id, issue_id, adapter_name, model, session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_cents_estimate, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "ce_old",
      "c1",
      "a1",
      null,
      null,
      "claude-oauth-local",
      "claude-sonnet-4-6",
      null,
      100,
      100,
      0,
      0,
      99,
      now - DEFAULT_WINDOW_MS - 1000,
    );
    const b = buildBriefing(db, "c1", null, now);
    expect(b.costCents).toBe(13);
  });

  it("reports the cursor on the returned briefing", () => {
    const { db, now } = seed();
    const cursor = now - 60_000;
    db.prepare("UPDATE companies SET briefing_reviewed_at = ? WHERE id = ?").run(cursor, "c1");
    const b = buildBriefing(db, "c1", cursor, now);
    expect(b.reviewedAt).toBe(cursor);
  });

  it("uses the 24h default window when sinceTs is null", () => {
    const { db, now } = seed();
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("g1", "c1", "a1", "Recent", "x", "task", "achieved", now - 60_000, now - 60_000);
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      "g2",
      "c1",
      "a1",
      "Old",
      "x",
      "task",
      "achieved",
      now - DEFAULT_WINDOW_MS - 60_000,
      now - DEFAULT_WINDOW_MS - 60_000,
    );
    const b = buildBriefing(db, "c1", null, now);
    expect(b.verified.map((g) => g.id)).toEqual(["g1"]);
  });
});
