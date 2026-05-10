import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { toolDefinitions, type ToolContext } from "../src/mcp/tools.js";

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
    expect(parsed.agents[0].name).toBe("Alice");
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
});
