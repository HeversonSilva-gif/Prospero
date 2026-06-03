import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
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
  const seedAgent = (id: string, role: string): void => {
    db.prepare(
      `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
       VALUES (?,?,?,?,'','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(id, "c1", id, role, Date.now(), Date.now());
  };
  seedAgent("ceo1", "ceo"); // real CEO — passes the new callerIsCeo guard
  seedAgent("bot1", "engineer"); // worker — must be rejected by the guard
  const dir = mkdtempSync(join(tmpdir(), "perm-"));
  // The CEO-side tools now EMIT events instead of touching the engine bridge
  // directly (the bridge is null in the MCP child). Capture emitted events so
  // the tests assert the cross-process contract.
  const emit = vi.fn();
  const ctx: ToolContext = {
    agentId: "ceo1",
    companyId: "c1",
    db,
    permissionsDir: dir,
    userDataDir: dir,
    emit,
  };
  return { db, ctx, dir, emit };
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
    // decide_request now marks the row decided immediately so list_pending_requests
    // stops showing this approval — prevents CEO from re-deciding in the next turn.
    const after = repo.getById(apv.id);
    expect(after?.status).toBe("approved");
    expect(after?.decidedBy).toBe("ceo1");
    // MAIN handles the timer-cancel + decision card off the emitted event.
    expect(env.emit).toHaveBeenCalledWith({
      kind: "approval.decided",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({
        approvalId: apv.id,
        decision: "approve",
        kind: "tool_call",
      }),
    });
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
    // Row must be decided immediately (same as approve path).
    const after = repo.getById(apv.id);
    expect(after?.status).toBe("rejected");
    expect(after?.decidedBy).toBe("ceo1");
    expect(env.emit).toHaveBeenCalledWith({
      kind: "approval.decided",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({
        approvalId: apv.id,
        decision: "reject",
        kind: "tool_call",
      }),
    });
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

  it("approve on a manager_request emits the decision (MAIN decides the row)", async () => {
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
    // The decision now happens in MAIN (handleApprovalEvent), not in the tool —
    // the tool only emits and the row stays pending until MAIN processes it.
    const after = repo.getById(apv.id);
    expect(after?.status).toBe("pending");
    expect(env.emit).toHaveBeenCalledWith({
      kind: "approval.decided",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({
        approvalId: apv.id,
        decision: "approve",
        kind: "manager_request",
        note: "ok",
      }),
    });
  });

  it("rejects a non-CEO caller (a worker cannot approve its own blocked call)", async () => {
    const repo = createApprovalsRepository(env.db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tuW" },
    });
    repo.setRouted(apv.id, "ceo");
    const out = JSON.parse(
      await decideTool.run(
        { approval_id: apv.id, decision: "approve" },
        { ...env.ctx, agentId: "bot1" },
      ),
    ) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/CEO/i);
    expect(existsSync(join(env.dir, "tuW.res.json"))).toBe(false);
    expect(repo.getById(apv.id)?.status).toBe("pending");
  });
});

const decideBatchTool = toolDefinitions.find((t) => t.name === "decide_batch")!;

describe("decide_batch", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it("rejects every decision when the caller is not the CEO", async () => {
    const repo = createApprovalsRepository(env.db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tuB" },
    });
    repo.setRouted(apv.id, "ceo");
    const out = JSON.parse(
      await decideBatchTool.run(
        { decisions: [{ approval_id: apv.id, decision: "approve" }] },
        { ...env.ctx, agentId: "bot1" },
      ),
    ) as { ok: boolean; decided: number; errors: { approval_id: string; error: string }[] };
    expect(out.decided).toBe(0);
    expect(out.errors[0]?.error).toMatch(/CEO/i);
    expect(existsSync(join(env.dir, "tuB.res.json"))).toBe(false);
    expect(repo.getById(apv.id)?.status).toBe("pending");
  });

  it("decides for a CEO caller (regression)", async () => {
    const repo = createApprovalsRepository(env.db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tuB2" },
    });
    repo.setRouted(apv.id, "ceo");
    const out = JSON.parse(
      await decideBatchTool.run(
        { decisions: [{ approval_id: apv.id, decision: "approve" }] },
        env.ctx,
      ),
    ) as { ok: boolean; decided: number };
    expect(out.decided).toBe(1);
    expect(existsSync(join(env.dir, "tuB2.res.json"))).toBe(true);
  });
});

const reqPermTool = toolDefinitions.find((t) => t.name === "request_permission")!;

describe("request_permission — deferred (slot reclaim)", () => {
  it("a .defer.json ends the turn cleanly and leaves the approval PENDING", async () => {
    const env = setup();
    const ctx = { ...env.ctx, agentId: "bot1" };
    // Scheduler pre-writes the defer fence for this tool_use_id.
    writeFileSync(join(env.dir, "tu_def.defer.json"), JSON.stringify({ behavior: "deferred" }));
    const out = JSON.parse(
      await reqPermTool.run(
        { tool_name: "Write", input: { path: "/x" }, tool_use_id: "tu_def" },
        ctx,
      ),
    ) as { behavior: string; message: string };
    // Turn-ending deny-style signal (claude's prompt-tool only accepts allow/deny).
    expect(out.behavior).toBe("deny");
    expect(out.message).toContain("reexecutada");
    // The approval row stays PENDING — it was NOT decided/rejected by the defer,
    // so it can still be decided for real later (then the agent re-runs the tool).
    const count = env.db
      .prepare("SELECT COUNT(*) n FROM approvals WHERE agent_id='bot1' AND status='pending'")
      .get() as { n: number };
    expect(count.n).toBe(1);
    // And the request fence is preserved so the pending approval stays decidable.
    expect(existsSync(join(env.dir, "tu_def.req.json"))).toBe(true);
  });
});

const reqDecisionTool = toolDefinitions.find((t) => t.name === "request_decision")!;

describe("request_decision", () => {
  it("creates a pending manager_request and emits approval.route", async () => {
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
    // Routing (CEO wake / human card) now happens in MAIN off the emitted event.
    expect(env.emit).toHaveBeenCalledWith({
      kind: "approval.route",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({
        approvalId: out.approval_id,
        managerTopic: "hire",
      }),
    });
  });
});
