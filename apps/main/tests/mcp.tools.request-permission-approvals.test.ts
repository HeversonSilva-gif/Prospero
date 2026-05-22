import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyMigrations } from "../src/db/migrations.js";
import { toolDefinitions, type ToolContext } from "../src/mcp/tools.js";

const tool = (name: string) => {
  const t = toolDefinitions.find((x) => x.name === name);
  if (t === undefined) throw new Error(`tool not found: ${name}`);
  return { run: t.run as (i: unknown, c: unknown) => Promise<string> };
};

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "co_1",
    "Co",
    Date.now(),
  );
  db.prepare(
    "INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ag_1", "co_1", "A", "engineer", "p", Date.now(), Date.now());
  const dir = mkdtempSync(join(tmpdir(), "perm-test-"));
  const ctx: ToolContext = {
    agentId: "ag_1",
    companyId: "co_1",
    db,
    permissionsDir: dir,
    userDataDir: "/tmp/userdata",
    emit: () => {},
  };
  return { db, ctx, dir };
};

describe("MCP request_permission writes approval row (no eager inbox card)", () => {
  it("creates a pending approval row but does NOT create an inbox card eagerly", async () => {
    const { db, ctx, dir } = setup();

    const toolUseId = "tu_test_1";
    // Resolve the request quickly so the tool returns inside the test.
    setTimeout(() => {
      writeFileSync(join(dir, `${toolUseId}.res.json`), JSON.stringify({ behavior: "allow" }));
    }, 50);

    await tool("request_permission").run(
      {
        tool_name: "Bash",
        input: { command: "ls" },
        tool_use_id: toolUseId,
      },
      ctx,
    );

    // The approval ROW must still be created (routing depends on it).
    const row = db
      .prepare("SELECT id, agent_id, kind FROM approvals WHERE payload_json LIKE ?")
      .get(`%${toolUseId}%`) as { id: string; agent_id: string; kind: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.kind).toBe("tool_call");
    expect(row?.agent_id).toBe("ag_1");

    // The eager inbox card is now gone — routing (onUserDecision) creates the
    // card only when the watcher fires, not here in the MCP tool.
    const inbox = db
      .prepare("SELECT id, approval_id, kind FROM inbox_items WHERE approval_id = ?")
      .get(row!.id) as { id: string; approval_id: string; kind: string } | undefined;
    expect(inbox).toBeUndefined();
  });
});
