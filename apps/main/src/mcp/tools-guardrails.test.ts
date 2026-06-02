import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { checkActionCap, SIDE_EFFECTING_LIMITS } from "../approvals/action-cap.js";

// gateAction awaits filesystem fences + a 30-min resolution, so it isn't unit-tested
// directly. This locks the cap contract gateAction relies on, against the real schema.
describe("action cap contract used by gateAction", () => {
  it("reports exceeded at the (limit)th post_to_x attempt in the window", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(`INSERT INTO companies (id, name, created_at) VALUES ('co_1','C',1)`).run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at) VALUES ('ag_1','co_1','A','worker','',1,1)`,
    ).run();
    const now = 5_000_000;
    const limit = SIDE_EFFECTING_LIMITS["post_to_x"] ?? 5;
    for (let i = 0; i < limit; i += 1) {
      db.prepare(
        `INSERT INTO approvals (id, agent_id, kind, payload_json, status, created_at)
         VALUES (?, 'ag_1', 'tool_call', ?, 'pending', ?)`,
      ).run(`apv_${i}`, JSON.stringify({ tool_name: "post_to_x" }), now - i * 100);
    }
    const r = checkActionCap(db, {
      companyId: "co_1",
      agentId: "ag_1",
      toolName: "post_to_x",
      now,
    });
    expect(r.exceeded).toBe(true);
    expect(r.scope).toBe("tool");
  });
});
