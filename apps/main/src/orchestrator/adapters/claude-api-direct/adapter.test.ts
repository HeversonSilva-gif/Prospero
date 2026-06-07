import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, ParsedEvent, SpawnContext } from "@prospero/shared";
import { applyMigrations } from "../../../db/migrations.js";
import { ClaudeApiDirectAdapter } from "./adapter.js";
import type { LlmClient, LlmResponse } from "./agentic-loop.js";

// A real CEO agent. fs-read so start() includes the fs tools. The model is the
// current Opus per the claude-api skill; the value is only echoed to the client.
const ceoAgent = (over: Partial<Agent> = {}): Agent => ({
  id: "agent_ceo1",
  companyId: "co_1",
  name: "CEO",
  role: "ceo",
  systemPrompt: "You are the CEO.",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-opus-4-8",
  capabilities: ["fs-read"],
  templateId: "role-ceo",
  reportsTo: null,
  adapterName: "claude-api-direct",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "monthly",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
  autoModeSetAt: null,
  ...over,
});

// Build a fake LlmClient that returns the given responses in order. The agentic
// loop calls createMessage once per round; exhausting the list yields a benign
// end_turn so the loop always terminates.
const fakeClient = (responses: LlmResponse[]): LlmClient => {
  let i = 0;
  return {
    createMessage: () => {
      const res = responses[i] ?? { stop_reason: "end_turn", content: [] };
      i += 1;
      return Promise.resolve(res);
    },
  };
};

let tmp: string;
let dbPath: string;

const makeCtx = (over: Partial<SpawnContext> = {}): SpawnContext => ({
  agent: ceoAgent(),
  apiKey: "sk-ant-api03-XXX",
  dbPath,
  permissionsDir: join(tmp, "perms"),
  eventsDir: join(tmp, "events"),
  userDataDir: tmp,
  ...over,
});

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "api-direct-"));
  dbPath = join(tmp, "test.db");
  const db = new Database(dbPath);
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('co_1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, template_id, created_at, updated_at)
     VALUES ('agent_ceo1','co_1','CEO','ceo','You are the CEO.','["fs-read"]','[]','supervised',
             0,'idle','claude-opus-4-8','claude-api-direct','role-ceo',0,0)`,
  ).run();
  db.close();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("ClaudeApiDirectAdapter", () => {
  it("constructor sets name + agentId", () => {
    const adapter = new ClaudeApiDirectAdapter(makeCtx());
    expect(adapter.name).toBe("claude-api-direct");
    expect(adapter.agentId).toBe("agent_ceo1");
  });

  it("start() throws when apiKey absent", () => {
    const ctx = makeCtx();
    delete (ctx as { apiKey?: string }).apiKey;
    const adapter = new ClaudeApiDirectAdapter(ctx);
    expect(() => adapter.start()).toThrow(/apiKey/);
  });

  it("start() builds a non-empty system prompt and includes fs tools for an fs-read agent", async () => {
    let captured: { system: string; tools: { name: string }[] } | null = null;
    const adapter = new ClaudeApiDirectAdapter(makeCtx(), {
      createClient: () => ({
        createMessage: (req) => {
          captured = { system: req.system, tools: req.tools };
          return Promise.resolve({ stop_reason: "end_turn", content: [] });
        },
      }),
    });
    await adapter.start();
    adapter.sendInput("hello");
    await new Promise((r) => setImmediate(r));

    expect(captured).not.toBeNull();
    const cap = captured as unknown as { system: string; tools: { name: string }[] };
    expect(cap.system.length).toBeGreaterThan(0);
    // CEO genesis playbook present (system prompt parity with the CLI path).
    expect(cap.system).toContain("Creating the business (genesis)");
    const toolNames = cap.tools.map((t) => t.name);
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Glob");
    expect(toolNames).toContain("Grep");
    adapter.kill();
  });

  it("does NOT include fs tools when the agent lacks fs-read", async () => {
    let toolNames: string[] = [];
    const ctx = makeCtx({ agent: ceoAgent({ capabilities: [] }) });
    const adapter = new ClaudeApiDirectAdapter(ctx, {
      createClient: () => ({
        createMessage: (req) => {
          toolNames = req.tools.map((t) => t.name);
          return Promise.resolve({ stop_reason: "end_turn", content: [] });
        },
      }),
    });
    await adapter.start();
    adapter.sendInput("hi");
    await new Promise((r) => setImmediate(r));
    expect(toolNames).not.toContain("Read");
    adapter.kill();
  });

  it("sendInput runs a turn: tool_use(list_goals) then end_turn → emits events + accumulates usage", async () => {
    const responses: LlmResponse[] = [
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Let me check the goals." },
          { type: "tool_use", id: "toolu_1", name: "list_goals", input: {} },
        ],
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 },
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "There are no goals yet." }],
        usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 3 },
      },
    ];
    const adapter = new ClaudeApiDirectAdapter(makeCtx(), {
      createClient: () => fakeClient(responses),
    });
    const seen: ParsedEvent[] = [];
    adapter.onEvent((e) => seen.push(e));
    await adapter.start();
    adapter.sendInput("any goals?");
    // Let the async turn (two rounds + the list_goals DB call) settle.
    await new Promise((r) => setTimeout(r, 50));

    const kinds = seen.map((e) => e.kind);
    expect(kinds).toContain("assistant-message");
    expect(kinds).toContain("tool-result");
    expect(kinds).toContain("turn-complete");

    const toolResult = seen.find((e) => e.kind === "tool-result");
    expect(toolResult).toBeDefined();
    // list_goals returns valid JSON (real DB, zero goals) — not an [error]/unknown tool.
    if (toolResult?.kind === "tool-result") {
      expect(toolResult.isError).toBe(false);
      expect(toolResult.content).toContain("goals");
    }

    const usage = adapter.getUsage();
    expect(usage.input).toBe(150);
    expect(usage.output).toBe(30);
    expect(usage.cache_read).toBe(5);
    expect(usage.cache_creation).toBe(3);
    adapter.kill();
  });

  it("a 429 from the client emits a rate-limited event (not onExit)", async () => {
    // Mirror the SDK's RateLimitError: an Error with status=429. We detect on the
    // numeric status (not instanceof) so a fake carrying it is recognized too.
    const rateLimitErr = Object.assign(new Error("rate_limit_error"), { status: 429 });
    const throwing: LlmClient = {
      createMessage: () => Promise.reject(rateLimitErr),
    };
    const adapter = new ClaudeApiDirectAdapter(makeCtx(), { createClient: () => throwing });
    const seen: ParsedEvent[] = [];
    let exitCode: number | null | undefined;
    adapter.onEvent((e) => seen.push(e));
    adapter.onExit((c) => (exitCode = c));
    await adapter.start();
    adapter.sendInput("go");
    await new Promise((r) => setTimeout(r, 30));

    const rl = seen.find((e) => e.kind === "rate-limited");
    expect(rl).toBeDefined();
    if (rl?.kind === "rate-limited") {
      expect(rl.scope).toBe("api-rate-limit");
      expect(rl.retryAfterSec).toBe(60);
    }
    // NOT an exit.
    expect(exitCode).toBeUndefined();
    adapter.kill();
  });

  it("a non-429 error emits onExit(1)", async () => {
    const throwing: LlmClient = {
      createMessage: () => Promise.reject(new Error("boom")),
    };
    const adapter = new ClaudeApiDirectAdapter(makeCtx(), { createClient: () => throwing });
    let exitCode: number | null | undefined;
    adapter.onExit((c) => (exitCode = c));
    await adapter.start();
    adapter.sendInput("go");
    await new Promise((r) => setTimeout(r, 30));
    expect(exitCode).toBe(1);
    adapter.kill();
  });

  it("kill() makes isAlive() false and emits onExit(0)", async () => {
    const adapter = new ClaudeApiDirectAdapter(makeCtx(), {
      createClient: () => fakeClient([]),
    });
    let exitCode: number | null | undefined;
    adapter.onExit((c) => (exitCode = c));
    await adapter.start();
    expect(adapter.isAlive()).toBe(true);
    adapter.kill();
    expect(adapter.isAlive()).toBe(false);
    expect(exitCode).toBe(0);
  });
});
