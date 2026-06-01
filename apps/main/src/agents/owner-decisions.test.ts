import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { recentOwnerDecisions } from "./owner-decisions.js";

const setup = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','A',0)").run();
  db.prepare(
    `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
     VALUES ('bot','c1','Bot','engineer','','[]','[]','supervised',0,'idle','m','a',0,0)`,
  ).run();
  return db;
};

const addApproval = (
  db: Database.Database,
  id: string,
  toolName: string,
  status: string,
  decidedBy: string | null,
  note: string | null,
  resolvedAt: number | null,
): void => {
  db.prepare(
    `INSERT INTO approvals (id, agent_id, kind, payload_json, status, decided_by, decision_note, created_at, resolved_at)
     VALUES (?, 'bot', 'tool_call', ?, ?, ?, ?, 0, ?)`,
  ).run(id, JSON.stringify({ tool_name: toolName }), status, decidedBy, note, resolvedAt);
};

describe("recentOwnerDecisions", () => {
  it("returns only user-decided approved/rejected rows, newest first, with tool + note", () => {
    const db = setup();
    addApproval(db, "a1", "post_to_x", "rejected", "user", "muito salesy", 300);
    addApproval(db, "a2", "send_email", "approved", "user", null, 200);
    addApproval(db, "a3", "deploy_app", "approved", "ceo", null, 250); // CEO, excluded
    addApproval(db, "a4", "post_to_x", "pending", null, null, null); // pending, excluded
    const out = recentOwnerDecisions(db, "c1", 10);
    expect(out.map((d) => d.tool)).toEqual(["post_to_x", "send_email"]);
    expect(out[0]).toMatchObject({ tool: "post_to_x", status: "rejected", note: "muito salesy" });
  });

  it("honors the limit", () => {
    const db = setup();
    addApproval(db, "a1", "x", "approved", "user", null, 100);
    addApproval(db, "a2", "y", "approved", "user", null, 200);
    expect(recentOwnerDecisions(db, "c1", 1)).toHaveLength(1);
  });
});
