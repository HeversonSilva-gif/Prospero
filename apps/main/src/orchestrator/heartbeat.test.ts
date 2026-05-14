import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanStaleAgents } from "./heartbeat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
  return db;
};

const insertAgent = (
  db: Database.Database,
  id: string,
  status: string,
  updatedAt: number,
): void => {
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, status, model, created_at, updated_at)
     VALUES (?, 'c1', 'A', 'r', 'p', ?, 'claude-sonnet-4-6', 0, ?)`,
  ).run(id, status, updatedAt);
};

const insertActivity = (db: Database.Database, agentId: string, createdAt: number): void => {
  db.prepare(
    `INSERT INTO activity_events (id, company_id, actor_kind, actor_id, action, entity_kind, entity_id, agent_id, payload_json, created_at)
     VALUES (?, 'c1', 'agent', ?, 'agent.hired', 'agent', ?, ?, '{}', ?)`,
  ).run(`act_${String(createdAt)}_${agentId}`, agentId, agentId, agentId, createdAt);
};

describe("scanStaleAgents", () => {
  it("returns no agents when status=working but recent activity (<5min)", () => {
    const db = setupDb();
    const now = Date.now();
    insertAgent(db, "ag1", "working", now);
    insertActivity(db, "ag1", now - 60_000); // 1 min ago
    expect(scanStaleAgents(db, 5 * 60_000)).toEqual([]);
  });

  it("returns agents with status=working but no activity in 5min", () => {
    const db = setupDb();
    const now = Date.now();
    insertAgent(db, "ag1", "working", now - 10 * 60_000);
    insertActivity(db, "ag1", now - 6 * 60_000); // 6 min ago
    expect(scanStaleAgents(db, 5 * 60_000).map((a) => a.id)).toEqual(["ag1"]);
  });

  it("ignores idle/error/terminated agents", () => {
    const db = setupDb();
    const now = Date.now();
    insertAgent(db, "ag1", "idle", now - 10 * 60_000);
    insertAgent(db, "ag2", "error", now - 10 * 60_000);
    insertAgent(db, "ag3", "terminated", now - 10 * 60_000);
    expect(scanStaleAgents(db, 5 * 60_000)).toEqual([]);
  });

  it("returns agent with status=working and no activity rows at all", () => {
    const db = setupDb();
    const now = Date.now();
    insertAgent(db, "ag1", "working", now - 10 * 60_000); // updated 10 min ago, no activity
    expect(scanStaleAgents(db, 5 * 60_000).map((a) => a.id)).toEqual(["ag1"]);
  });
});
