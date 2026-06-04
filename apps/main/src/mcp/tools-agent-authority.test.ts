import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { toolDefinitions, type ToolContext } from "./tools.js";

// v0.2.10 toolbox audit C1: hire_agent / fire_agent authority is enforced in code, not only
// by --allowedTools. The CEO and a delegation-capable manager (e.g. a PM) may hire/fire; a
// plain worker may not even if it reaches the tool via the gate; and no one but the CEO may
// remove the CEO.
const hireTool = toolDefinitions.find((t) => t.name === "hire_agent")!;
const fireTool = toolDefinitions.find((t) => t.name === "fire_agent")!;

const seed = (
  db: Database.Database,
  id: string,
  role: string,
  caps: string[],
  templateId: string | null = null,
): void => {
  db.prepare(
    `INSERT INTO agents (id,company_id,name,role,template_id,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
     VALUES (?,?,?,?,?,'',?,'[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(id, "c1", id, role, templateId, JSON.stringify(caps), Date.now(), Date.now());
};

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','c1',?)").run(Date.now());
  seed(db, "ceo1", "ceo", [], "role-ceo");
  seed(db, "pm1", "pm", ["delegation", "issues"]);
  seed(db, "eng1", "engineer", ["shell", "fs-write"]);
  seed(db, "worker1", "engineer", ["shell"]);
  const events: { kind: string; payload: unknown }[] = [];
  const ctxFor = (agentId: string): ToolContext => ({
    agentId,
    companyId: "c1",
    db,
    permissionsDir: "/tmp/perm",
    userDataDir: "/tmp/perm",
    emit: (e) => events.push(e),
  });
  return { db, ctxFor, events };
}

const hireInput = { name: "New", role: "engineer", system_prompt: "sp" };

describe("hire_agent — authority (C1)", () => {
  it("a plain worker (no delegation) cannot hire", async () => {
    const { db, ctxFor } = setup();
    const out = JSON.parse(await hireTool.run(hireInput, ctxFor("eng1"))) as { ok?: boolean };
    expect(out.ok).toBe(false);
    // No agent created beyond the four seeded.
    const count = db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number };
    expect(count.n).toBe(4);
  });

  it("the CEO can hire", async () => {
    const { ctxFor } = setup();
    const out = JSON.parse(await hireTool.run(hireInput, ctxFor("ceo1"))) as { id?: string };
    expect(out.id).toBeDefined();
  });

  it("a delegation-capable manager (PM) can hire", async () => {
    const { ctxFor } = setup();
    const out = JSON.parse(await hireTool.run(hireInput, ctxFor("pm1"))) as { id?: string };
    expect(out.id).toBeDefined();
  });
});

describe("fire_agent — authority (C1)", () => {
  it("a plain worker (no delegation) cannot fire", async () => {
    const { db, ctxFor, events } = setup();
    const out = JSON.parse(await fireTool.run({ agent_id: "worker1" }, ctxFor("eng1"))) as {
      ok: boolean;
    };
    expect(out.ok).toBe(false);
    expect(db.prepare("SELECT id FROM agents WHERE id='worker1'").get()).toBeDefined();
    expect(events.find((e) => e.kind === "agent.kill")).toBeUndefined();
  });

  it("a delegation manager can fire an ordinary worker", async () => {
    const { db, ctxFor } = setup();
    const out = JSON.parse(await fireTool.run({ agent_id: "worker1" }, ctxFor("pm1"))) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
    expect(db.prepare("SELECT id FROM agents WHERE id='worker1'").get()).toBeUndefined();
  });

  it("a delegation manager CANNOT fire the CEO", async () => {
    const { db, ctxFor, events } = setup();
    const out = JSON.parse(await fireTool.run({ agent_id: "ceo1" }, ctxFor("pm1"))) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/CEO/);
    expect(db.prepare("SELECT id FROM agents WHERE id='ceo1'").get()).toBeDefined();
    expect(events.find((e) => e.kind === "agent.kill")).toBeUndefined();
  });
});
