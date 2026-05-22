import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createApprovalsRepository } from "../approvals/repository.js";
import { toolDefinitions, type ToolContext } from "./tools.js";

const decideTool = toolDefinitions.find((t) => t.name === "decide_request")!;

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',?)").run(Date.now());
  for (const id of ["ceo1", "bot1"]) {
    db.prepare(
      `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
       VALUES (?,?,?,'engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(id, "c1", id, Date.now(), Date.now());
  }
  const dir = mkdtempSync(join(tmpdir(), "perm-"));
  const ctx: ToolContext = {
    agentId: "ceo1",
    companyId: "c1",
    db,
    permissionsDir: dir,
    userDataDir: dir,
    emit: () => {},
  };
  return { db, ctx, dir };
}

describe("decide_request", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it("approve on a tool_call writes the .res.json the blocked agent polls", async () => {
    const repo = createApprovalsRepository(env.db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tu1" },
    });
    repo.setRouted(apv.id, "ceo");
    await decideTool.run({ approval_id: apv.id, decision: "approve", note: "ok" }, env.ctx);
    expect(existsSync(join(env.dir, "tu1.res.json"))).toBe(true);
    const body = JSON.parse(readFileSync(join(env.dir, "tu1.res.json"), "utf8")) as {
      behavior: string;
      decidedBy: string;
    };
    expect(body.behavior).toBe("allow");
    expect(body.decidedBy).toBe("ceo1");
  });

  it("reject on a tool_call writes the .deny.json with the note", async () => {
    const repo = createApprovalsRepository(env.db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tu2" },
    });
    repo.setRouted(apv.id, "ceo");
    await decideTool.run({ approval_id: apv.id, decision: "reject", note: "no" }, env.ctx);
    const body = JSON.parse(readFileSync(join(env.dir, "tu2.deny.json"), "utf8")) as {
      behavior: string;
      message: string;
    };
    expect(body.behavior).toBe("deny");
    expect(body.message).toBe("no");
  });

  it("is a no-op when the approval is already resolved", async () => {
    const repo = createApprovalsRepository(env.db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tu3" },
    });
    repo.setRouted(apv.id, "ceo");
    repo.decide(apv.id, "approved", "user");
    const out = await decideTool.run({ approval_id: apv.id, decision: "approve" }, env.ctx);
    expect(existsSync(join(env.dir, "tu3.res.json"))).toBe(false);
    expect(out).toContain("already");
  });

  it("approve on a manager_request decides the row (decidedBy = ceo)", async () => {
    const repo = createApprovalsRepository(env.db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "Preciso de um designer", thread_id: "th1" },
    });
    repo.setRouted(apv.id, "ceo");
    const out = JSON.parse(
      await decideTool.run({ approval_id: apv.id, decision: "approve", note: "ok" }, env.ctx),
    ) as { ok: boolean; decision: string };
    expect(out.ok).toBe(true);
    const after = repo.getById(apv.id);
    expect(after?.status).toBe("approved");
    expect(after?.decidedBy).toBe("ceo1");
    expect(after?.decisionNote).toBe("ok");
  });
});

const reqDecisionTool = toolDefinitions.find((t) => t.name === "request_decision")!;

describe("request_decision", () => {
  it("creates a pending manager_request and returns its id immediately", async () => {
    const env = setup();
    const ctx = { ...env.ctx, agentId: "bot1" }; // requester is the worker, not the CEO
    const out = JSON.parse(
      await reqDecisionTool.run({ topic: "hire", summary: "Preciso de um designer" }, ctx),
    ) as { status: string; approval_id: string };
    expect(out.status).toBe("pending");
    const repo = createApprovalsRepository(env.db);
    const apv = repo.getById(out.approval_id);
    expect(apv?.kind).toBe("manager_request");
    expect(apv?.status).toBe("pending");
  });
});
