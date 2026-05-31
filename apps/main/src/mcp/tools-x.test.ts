import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { preapprovalKey, preapprovalPath } from "../approvals/deferred-approval.js";
import { toolDefinitions, type ToolContext } from "./tools.js";

const postTool = toolDefinitions.find((t) => t.name === "post_to_x")!;
const replyTool = toolDefinitions.find((t) => t.name === "reply_on_x")!;

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',?)").run(Date.now());
  db.prepare(
    `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
     VALUES ('bot1','c1','Bot','engineer','','["connectors"]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(Date.now(), Date.now());
  const dir = mkdtempSync(join(tmpdir(), "perm-x-"));
  return { db, dir };
}

// Wait until gateAction has written its .req.json, return the parsed body.
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

describe("post_to_x", () => {
  it("self-gates, then emits x.post and returns the result MAIN writes back", async () => {
    const { db, dir } = setup();
    // Pre-approval fence for the exact action ⇒ gateAction allows without waiting.
    writeFileSync(preapprovalPath(dir, "bot1", preapprovalKey("post_to_x", { text: "gm" })), "{}");
    // The emit captures the postId and plays MAIN's role: write the result file.
    const emit = vi.fn((ev: { kind: string; payload: unknown }) => {
      if (ev.kind === "x.post") {
        const { postId } = ev.payload as { postId: string };
        writeFileSync(
          join(dir, `${postId}.xpost.json`),
          JSON.stringify({ ok: true, id: "42", url: "https://x.com/i/status/42" }),
        );
      }
    });
    const ctx: ToolContext = {
      agentId: "bot1",
      companyId: "c1",
      db,
      permissionsDir: dir,
      userDataDir: dir,
      emit,
    };
    const out = JSON.parse(await postTool.run({ text: "gm" }, ctx)) as {
      ok: boolean;
      url: string;
    };
    expect(out).toEqual({ ok: true, id: "42", url: "https://x.com/i/status/42" });
    expect(emit).toHaveBeenCalledWith({
      kind: "x.post",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({ text: "gm" }),
    });
  });

  it("does NOT post when the gate rejects the tool call", async () => {
    const { db, dir } = setup();
    const emit = vi.fn();
    const ctx: ToolContext = {
      agentId: "bot1",
      companyId: "c1",
      db,
      permissionsDir: dir,
      userDataDir: dir,
      emit,
    };
    const runPromise = postTool.run({ text: "spam" }, ctx);
    const req = await waitForReq(dir);
    expect(req.tool_name).toBe("post_to_x");
    writeFileSync(
      join(dir, `${req.tool_use_id}.deny.json`),
      JSON.stringify({ behavior: "deny", message: "nope" }),
    );
    const out = JSON.parse(await runPromise) as { ok: boolean; status: string; message: string };
    expect(out.ok).toBe(false);
    expect(out.status).toBe("deny");
    // The post event must NEVER fire on a rejected call.
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("reply_on_x", () => {
  it("self-gates with the tweet id in the approval payload, then emits a threaded post", async () => {
    const { db, dir } = setup();
    const emit = vi.fn((ev: { kind: string; payload: unknown }) => {
      if (ev.kind === "x.post") {
        const { postId } = ev.payload as { postId: string };
        writeFileSync(
          join(dir, `${postId}.xpost.json`),
          JSON.stringify({ ok: true, id: "99", url: "https://x.com/i/status/99" }),
        );
      }
    });
    const ctx: ToolContext = {
      agentId: "bot1",
      companyId: "c1",
      db,
      permissionsDir: dir,
      userDataDir: dir,
      emit,
    };
    const runPromise = replyTool.run({ tweet_id: "555", text: "obrigado!" }, ctx);
    const req = await waitForReq(dir);
    // The approval the user sees carries both the tweet id and the reply text.
    const reqBody = JSON.parse(readFileSync(join(dir, `${req.tool_use_id}.req.json`), "utf8")) as {
      tool_input: { tweet_id: string; text: string };
    };
    expect(reqBody.tool_input).toEqual({ tweet_id: "555", text: "obrigado!" });
    writeFileSync(join(dir, `${req.tool_use_id}.res.json`), JSON.stringify({ behavior: "allow" }));
    const out = JSON.parse(await runPromise) as { ok: boolean; url: string };
    expect(out.ok).toBe(true);
    expect(out.url).toBe("https://x.com/i/status/99");
    expect(emit).toHaveBeenCalledWith({
      kind: "x.post",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({ text: "obrigado!", inReplyToId: "555" }),
    });
    expect(existsSync(join(dir, `${req.tool_use_id}.req.json`))).toBe(false);
  });
});
