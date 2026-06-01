import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { toolDefinitions, type ToolContext } from "./tools.js";

const sendTool = toolDefinitions.find((t) => t.name === "send_email")!;
const readTool = toolDefinitions.find((t) => t.name === "read_emails")!;

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',?)").run(Date.now());
  db.prepare(
    `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
     VALUES ('bot1','c1','Bot','support','','["email"]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(Date.now(), Date.now());
  const dir = mkdtempSync(join(tmpdir(), "perm-email-"));
  return { db, dir };
}

const waitForReq = async (dir: string): Promise<{ tool_use_id: string; tool_name: string }> => {
  for (let i = 0; i < 100; i++) {
    const f = readdirSync(dir).find((n) => n.endsWith(".req.json"));
    if (f !== undefined)
      return JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        tool_use_id: string;
        tool_name: string;
      };
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no .req.json appeared");
};

const ctxFor = (
  db: Database.Database,
  dir: string,
  emit: (ev: { kind: string; payload: unknown }) => void,
): ToolContext => ({
  agentId: "bot1",
  companyId: "c1",
  db,
  permissionsDir: dir,
  userDataDir: dir,
  emit,
});

describe("send_email", () => {
  it("self-gates, then emits email.send (with the body in the approval) and returns MAIN's result", async () => {
    const { db, dir } = setup();
    const emit = vi.fn((ev: { kind: string; payload: unknown }) => {
      if (ev.kind === "email.send") {
        const { requestId } = ev.payload as { requestId: string };
        writeFileSync(
          join(dir, `${requestId}.email.json`),
          JSON.stringify({ ok: true, messageId: "m1" }),
        );
      }
    });
    const runPromise = sendTool.run(
      { to: "buyer@x.com", subject: "Seu acesso", body: "Obrigado pela compra!" },
      ctxFor(db, dir, emit),
    );
    const req = await waitForReq(dir);
    expect(req.tool_name).toBe("send_email");
    const reqBody = JSON.parse(readFileSync(join(dir, `${req.tool_use_id}.req.json`), "utf8")) as {
      tool_input: { to: string; body: string };
    };
    expect(reqBody.tool_input.body).toBe("Obrigado pela compra!");
    writeFileSync(join(dir, `${req.tool_use_id}.res.json`), JSON.stringify({ behavior: "allow" }));
    const out = JSON.parse(await runPromise) as { ok: boolean; messageId: string };
    expect(out).toEqual({ ok: true, messageId: "m1" });
  });

  it("does NOT send when the gate rejects", async () => {
    const { db, dir } = setup();
    const emit = vi.fn();
    const runPromise = sendTool.run(
      { to: "a@b.com", subject: "s", body: "b" },
      ctxFor(db, dir, emit),
    );
    const req = await waitForReq(dir);
    writeFileSync(
      join(dir, `${req.tool_use_id}.deny.json`),
      JSON.stringify({ behavior: "deny", message: "no" }),
    );
    const out = JSON.parse(await runPromise) as { ok: boolean; status: string };
    expect(out.ok).toBe(false);
    expect(out.status).toBe("deny");
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("read_emails", () => {
  it("emits email.read without a gate and returns MAIN's result", async () => {
    const { db, dir } = setup();
    const emit = vi.fn((ev: { kind: string; payload: unknown }) => {
      if (ev.kind === "email.read") {
        const { requestId } = ev.payload as { requestId: string };
        writeFileSync(
          join(dir, `${requestId}.email.json`),
          JSON.stringify({ ok: true, emails: [{ from: "x@y.com", subject: "hi" }] }),
        );
      }
    });
    const out = JSON.parse(await readTool.run({ limit: 5 }, ctxFor(db, dir, emit))) as {
      ok: boolean;
      emails: unknown[];
    };
    expect(out.ok).toBe(true);
    expect(out.emails).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith({
      kind: "email.read",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({ limit: 5 }),
    });
  });
});
