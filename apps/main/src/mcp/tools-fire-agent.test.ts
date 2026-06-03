import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { toolDefinitions, type ToolContext } from "./tools.js";

const fireTool = toolDefinitions.find((t) => t.name === "fire_agent")!;

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  for (const c of ["c1", "c2"]) {
    db.prepare("INSERT INTO companies (id,name,created_at) VALUES (?,?,?)").run(c, c, Date.now());
  }
  const seedAgent = (id: string, companyId: string, role: string): void => {
    db.prepare(
      `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
       VALUES (?,?,?,?,'','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(id, companyId, id, role, Date.now(), Date.now());
  };
  seedAgent("ceo1", "c1", "ceo");
  seedAgent("victim2", "c2", "engineer"); // another company's agent
  const events: { kind: string; payload: unknown }[] = [];
  const ctx: ToolContext = {
    agentId: "ceo1",
    companyId: "c1",
    db,
    permissionsDir: "/tmp/perm",
    userDataDir: "/tmp/perm",
    emit: (e) => events.push(e),
  };
  return { db, ctx, events };
}

describe("fire_agent — company scope", () => {
  it("refuses to fire an agent in another company (no delete, no kill)", async () => {
    const { db, ctx, events } = setup();
    const out = JSON.parse(await fireTool.run({ agent_id: "victim2" }, ctx)) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(db.prepare("SELECT id FROM agents WHERE id = 'victim2'").get()).toBeDefined();
    expect(events.find((e) => e.kind === "agent.kill")).toBeUndefined();
  });

  it("fires an agent in the same company", async () => {
    const { db, ctx, events } = setup();
    db.prepare(
      `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
       VALUES ('w1','c1','w1','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(Date.now(), Date.now());
    const out = JSON.parse(await fireTool.run({ agent_id: "w1" }, ctx)) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(db.prepare("SELECT id FROM agents WHERE id = 'w1'").get()).toBeUndefined();
    expect(events.find((e) => e.kind === "agent.kill")).toBeDefined();
  });
});
