import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { toolDefinitions, waitForResolution, type ToolContext } from "../src/mcp/tools.js";
import { createSettingsRepository } from "../src/settings/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";

const makeCtx = (emit = vi.fn()): ToolContext => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return {
    agentId: "a",
    companyId: "c",
    db,
    permissionsDir: "/tmp/perm",
    emit,
  };
};

describe("mcp tools (M3 mocks)", () => {
  it("list_agents returns agents from DB filtered by company", async () => {
    const ctx = makeCtx();
    // makeCtx already creates an in-memory DB with migrations applied (Task 4.1)
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c2','Other',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a1','c','Alice','FE','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a2','c2','Bob','BE','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();

    const def = toolDefinitions.find((t) => t.name === "list_agents");
    expect(def).toBeDefined();
    const result = await def!.run({}, ctx);
    const parsed = JSON.parse(result) as { agents: Array<{ id: string; name: string }> };
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0]!.name).toBe("Alice");
  });

  it("read_thread returns ordered messages between two agents", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    // thread participants_json must use the canonical threadKey ("a|alice" sorted = "a|alice"; "a"<"alice" lexicographically)
    ctx.db
      .prepare(
        `INSERT INTO threads(id,company_id,participants_json,created_at) VALUES('t1','c','a|alice',1)`,
      )
      .run();
    ctx.db
      .prepare(
        `INSERT INTO messages(id,thread_id,sender_kind,sender_id,content,created_at) VALUES('m1','t1','agent','a','hi',10)`,
      )
      .run();
    ctx.db
      .prepare(
        `INSERT INTO messages(id,thread_id,sender_kind,sender_id,content,created_at) VALUES('m2','t1','agent','alice','reply',20)`,
      )
      .run();

    const def = toolDefinitions.find((t) => t.name === "read_thread");
    const result = await def!.run({ other_agent_id: "alice" }, ctx);
    const parsed = JSON.parse(result) as { messages: Array<{ content: string }> };
    expect(parsed.messages.map((m) => m.content)).toEqual(["hi", "reply"]);
  });

  it("hire_agent rejects empty role at parse time", () => {
    const def = toolDefinitions.find((t) => t.name === "hire_agent");
    expect(def).toBeDefined();
    expect(def!.inputSchema.safeParse({}).success).toBe(false);
  });

  it("create_issue accepts optional fields", () => {
    const def = toolDefinitions.find((t) => t.name === "create_issue");
    expect(def).toBeDefined();
    const result = def!.inputSchema.safeParse({ project: "P", title: "T" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { title: string }).title).toBe("T");
    }
  });

  it("notify_user accepts optional requires_action", () => {
    const def = toolDefinitions.find((t) => t.name === "notify_user");
    expect(def).toBeDefined();
    const result = def!.inputSchema.safeParse({
      title: "Hi",
      requires_action: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { requires_action: boolean }).requires_action).toBe(true);
    }
  });

  it("message_agent requires both fields", () => {
    const def = toolDefinitions.find((t) => t.name === "message_agent");
    expect(def).toBeDefined();
    expect(def!.inputSchema.safeParse({ agent: "a" }).success).toBe(false);
    expect(def!.inputSchema.safeParse({ content: "c" }).success).toBe(false);
  });

  it("hire_agent creates agent + thread, sets reports_to to caller", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a','c','CEO','CEO','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();

    const def = toolDefinitions.find((t) => t.name === "hire_agent");
    const result = await def!.run(
      {
        name: "Alice",
        role: "FE",
        system_prompt: "you are alice, a frontend engineer focused on react and typescript work",
      },
      ctx,
    );
    const parsed = JSON.parse(result) as { id: string; name: string; role: string };
    expect(parsed.name).toBe("Alice");
    expect(parsed.role).toBe("FE");

    const row = ctx.db.prepare("SELECT * FROM agents WHERE id = ?").get(parsed.id) as {
      reports_to: string | null;
      mode: string;
      system_prompt: string;
    };
    expect(row.reports_to).toBe("a");
    expect(row.mode).toBe("supervised");
    expect(row.system_prompt).toMatch(/alice/i);

    // thread between caller and new agent must exist
    const thr = ctx.db
      .prepare("SELECT participants_json FROM threads WHERE company_id = ?")
      .get("c") as { participants_json: string } | undefined;
    expect(thr).toBeDefined();
  });

  it("hire_agent rejects short system_prompt", () => {
    const def = toolDefinitions.find((t) => t.name === "hire_agent");
    const result = def!.inputSchema.safeParse({ name: "X", role: "Y", system_prompt: "too short" });
    expect(result.success).toBe(false);
  });

  it("fire_agent emits agent.kill control event + deletes from DB", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('victim','c','x','y','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();

    const def = toolDefinitions.find((t) => t.name === "fire_agent");
    await def!.run({ agent_id: "victim" }, ctx);
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "agent.kill",
        payload: { agentId: "victim" },
      }),
    );
    const row = ctx.db.prepare("SELECT * FROM agents WHERE id = ?").get("victim");
    expect(row).toBeUndefined();
  });

  it("message_agent appends to thread + emits agent.deliver", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a','c','CEO','CEO','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('alice','c','Alice','FE','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();

    const def = toolDefinitions.find((t) => t.name === "message_agent");
    const result = await def!.run({ agent_id: "alice", content: "do X" }, ctx);
    expect(JSON.parse(result)).toMatchObject({ queued: true });
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "agent.deliver",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payload: expect.objectContaining({ targetId: "alice", senderName: "CEO", content: "do X" }),
      }),
    );
    const msgs = ctx.db.prepare("SELECT * FROM messages WHERE sender_id = 'a'").all() as Array<{
      content: string;
    }>;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("do X");
  });

  it("message_agent fails gracefully when target agent not found", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a','c','CEO','CEO','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();

    const def = toolDefinitions.find((t) => t.name === "message_agent");
    const result = await def!.run({ agent_id: "ghost", content: "?" }, ctx);
    const parsed = JSON.parse(result) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
  });

  it("notify_user inserts inbox_item with kind default 'completed'", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a','c','CEO','CEO','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();

    const def = toolDefinitions.find((t) => t.name === "notify_user");
    await def!.run({ title: "Done!", body: "task X" }, ctx);
    const items = ctx.db.prepare("SELECT * FROM inbox_items WHERE actor_id = 'a'").all() as Array<{
      kind: string;
      title: string;
      preview: string | null;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("completed");
    expect(items[0]!.title).toBe("Done!");
    expect(items[0]!.preview).toBe("task X");
  });

  it("notify_user accepts kind security_alert", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a','c','CEO','CEO','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();

    const def = toolDefinitions.find((t) => t.name === "notify_user");
    await def!.run({ title: "alert!", kind: "security_alert", requires_action: true }, ctx);
    const items = ctx.db.prepare("SELECT * FROM inbox_items WHERE actor_id = 'a'").all() as Array<{
      kind: string;
      requires_action: number;
    }>;
    expect(items[0]!.kind).toBe("security_alert");
    expect(items[0]!.requires_action).toBe(1);
  });

  it("waitForResolution returns when res.json appears", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-"));
    const promise = waitForResolution(dir, "tu1", 5000);
    setTimeout(() => {
      writeFileSync(join(dir, "tu1.res.json"), JSON.stringify({ behavior: "allow" }));
    }, 150);
    const result = await promise;
    expect(result).toEqual({ behavior: "allow" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("waitForResolution returns deny when deny.json appears", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-"));
    const promise = waitForResolution(dir, "tu2", 5000);
    setTimeout(() => {
      writeFileSync(
        join(dir, "tu2.deny.json"),
        JSON.stringify({ behavior: "deny", message: "nope" }),
      );
    }, 150);
    const result = await promise;
    expect(result).toEqual({ behavior: "deny", message: "nope" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("waitForResolution times out with deny after configured ms", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-"));
    const result = await waitForResolution(dir, "tu_timeout", 200);
    expect(result.behavior).toBe("deny");
    expect((result as { message: string }).message).toMatch(/timeout/i);
    rmSync(dir, { recursive: true, force: true });
  });

  it("hire_agent uses settings.defaultModelForNewAgents when no override", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a','c','Caller','C','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();

    // Set the global default to opus
    const settings = createSettingsRepository(ctx.db);
    settings.write({ defaultModelForNewAgents: "claude-opus-4-7" });

    const def = toolDefinitions.find((t) => t.name === "hire_agent");
    expect(def).toBeDefined();
    const result = await def!.run(
      {
        name: "Eng",
        role: "Engineer",
        system_prompt: "you are an engineer, write good code",
      },
      ctx,
    );
    const parsed = JSON.parse(result) as { id: string };
    const created = createAgentsRepository(ctx.db).getById(parsed.id);
    expect(created?.model).toBe("claude-opus-4-7");
  });
});
