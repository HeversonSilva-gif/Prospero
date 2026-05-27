import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createApprovalsRepository } from "../src/approvals/repository.js";
import { toolDefinitions, type ToolContext } from "../src/mcp/tools.js";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const findTool = (name: string) => {
  const t = toolDefinitions.find((x) => x.name === name);
  if (t === undefined) throw new Error(`tool not found: ${name}`);
  return t;
};

const seedCompanyAgents = (db: Database.Database): void => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a_ceo', 'c1', 'CEO', 'CEO', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-opus-4-7', 'claude-oauth-local', 0, 0),
            ('a_req',  'c1', 'W',   'engineer', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run();
};

describe("decide_batch MCP tool", () => {
  let db: Database.Database;
  let permissionsDir: string;
  let emitted: { kind: string; payload: unknown }[];
  let ctx: ToolContext;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgents(db);
    permissionsDir = mkdtempSync(join(tmpdir(), "prospero-coalesce-"));
    emitted = [];
    ctx = {
      agentId: "a_ceo",
      companyId: "c1",
      db,
      permissionsDir,
      userDataDir: permissionsDir,
      emit: (e) => emitted.push(e),
    };
  });

  it("decides every approval in the batch and writes res.json for tool_call approvals", async () => {
    const repo = createApprovalsRepository(db);
    const a1 = repo.create({
      agentId: "a_req",
      kind: "tool_call",
      payload: { tool_use_id: "tu_1", tool_name: "Read" },
    });
    const a2 = repo.create({
      agentId: "a_req",
      kind: "tool_call",
      payload: { tool_use_id: "tu_2", tool_name: "Read" },
    });
    repo.setRouted(a1.id, "ceo");
    repo.setRouted(a2.id, "ceo");

    const tool = findTool("decide_batch");
    const raw = (await (tool.run as (i: unknown, c: unknown) => Promise<string>)(
      {
        decisions: [
          { approval_id: a1.id, decision: "approve" },
          { approval_id: a2.id, decision: "reject", note: "n2" },
        ],
      },
      ctx,
    ));
    const out = JSON.parse(raw) as { ok: boolean; decided: number; errors: unknown[] };

    expect(out.ok).toBe(true);
    expect(out.decided).toBe(2);
    expect(out.errors).toEqual([]);

    expect(existsSync(join(permissionsDir, "tu_1.res.json"))).toBe(true);
    expect(existsSync(join(permissionsDir, "tu_2.deny.json"))).toBe(true);

    const after1 = repo.getById(a1.id);
    const after2 = repo.getById(a2.id);
    expect(after1?.status).toBe("approved");
    expect(after2?.status).toBe("rejected");
    expect(emitted.filter((e) => e.kind === "approval.decided")).toHaveLength(2);
  });

  it("skips approvals that are already resolved and surfaces them as errors", async () => {
    const repo = createApprovalsRepository(db);
    const a1 = repo.create({
      agentId: "a_req",
      kind: "tool_call",
      payload: { tool_use_id: "tu_1", tool_name: "Read" },
    });
    repo.setRouted(a1.id, "ceo");
    repo.decide(a1.id, "approved", "system");

    const tool = findTool("decide_batch");
    const raw = (await (tool.run as (i: unknown, c: unknown) => Promise<string>)(
      { decisions: [{ approval_id: a1.id, decision: "approve" }] },
      ctx,
    ));
    const out = JSON.parse(raw) as {
      ok: boolean;
      decided: number;
      errors: { approval_id: string; error: string }[];
    };

    expect(out.decided).toBe(0);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]?.approval_id).toBe(a1.id);
  });

  it("skips approvals not routed to the calling CEO", async () => {
    const repo = createApprovalsRepository(db);
    const a1 = repo.create({
      agentId: "a_req",
      kind: "tool_call",
      payload: { tool_use_id: "tu_1", tool_name: "Read" },
    });
    repo.setRouted(a1.id, "user"); // routed to human, not CEO

    const tool = findTool("decide_batch");
    const raw = (await (tool.run as (i: unknown, c: unknown) => Promise<string>)(
      { decisions: [{ approval_id: a1.id, decision: "approve" }] },
      ctx,
    ));
    const out = JSON.parse(raw) as { decided: number; errors: { error: string }[] };

    expect(out.decided).toBe(0);
    expect(out.errors).toHaveLength(1);
  });

  it("handles manager_request kind via emit only (MAIN handler does the decide)", async () => {
    const repo = createApprovalsRepository(db);
    const a1 = repo.create({
      agentId: "a_req",
      kind: "manager_request",
      payload: { topic: "hire", role: "engineer" },
    });
    repo.setRouted(a1.id, "ceo");

    const tool = findTool("decide_batch");
    const raw = (await (tool.run as (i: unknown, c: unknown) => Promise<string>)(
      { decisions: [{ approval_id: a1.id, decision: "approve" }] },
      ctx,
    ));
    const out = JSON.parse(raw) as { ok: boolean; decided: number };

    expect(out.ok).toBe(true);
    expect(out.decided).toBe(1);
    // manager_request decisions are NOT written to permissionsDir
    expect(existsSync(join(permissionsDir, "tu_1.res.json"))).toBe(false);
    // emit happens once with manager_request kind
    expect(
      emitted.filter(
        (e) =>
          e.kind === "approval.decided" &&
          (e.payload as { kind: string }).kind === "manager_request",
      ),
    ).toHaveLength(1);
  });
});
