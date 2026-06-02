import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { checkActionCap, SIDE_EFFECTING_LIMITS } from "./action-cap.js";

const seed = (db: Database.Database, agentId: string, toolName: string, createdAt: number) => {
  db.prepare(
    `INSERT INTO approvals (id, agent_id, kind, payload_json, status, created_at)
     VALUES (?, ?, 'tool_call', ?, 'pending', ?)`,
  ).run(
    `apv_${createdAt}_${Math.floor(createdAt % 100000)}`,
    agentId,
    JSON.stringify({ tool_name: toolName }),
    createdAt,
  );
};

const setupAgent = (db: Database.Database) => {
  db.prepare(`INSERT INTO companies (id, name, created_at) VALUES ('co_1','C',1)`).run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at)
     VALUES ('ag_1','co_1','A','worker','',1,1)`,
  ).run();
};

describe("checkActionCap", () => {
  it("read/unknown tools are never capped", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const r = checkActionCap(db, {
      companyId: "co_1",
      agentId: "ag_1",
      toolName: "x_insights_read",
      now: 1_000_000,
    });
    expect(r.exceeded).toBe(false);
  });

  it("counts side-effecting attempts in the trailing hour, per agent+tool", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupAgent(db);
    const now = 10_000_000;
    for (let i = 0; i < 5; i += 1) seed(db, "ag_1", "post_to_x", now - i * 1000);
    seed(db, "ag_1", "post_to_x", now - 4_000_000); // older than 1h — excluded
    const r = checkActionCap(db, {
      companyId: "co_1",
      agentId: "ag_1",
      toolName: "post_to_x",
      now,
    });
    expect(r.count).toBe(5);
    expect(r.limit).toBe(SIDE_EFFECTING_LIMITS.post_to_x);
    expect(r.exceeded).toBe(true);
  });

  it("does not count a different tool toward this tool's cap", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupAgent(db);
    const now = 10_000_000;
    for (let i = 0; i < 9; i += 1) seed(db, "ag_1", "send_email", now - i * 1000);
    const r = checkActionCap(db, {
      companyId: "co_1",
      agentId: "ag_1",
      toolName: "post_to_x",
      now,
    });
    expect(r.count).toBe(0);
    expect(r.exceeded).toBe(false);
  });
});
