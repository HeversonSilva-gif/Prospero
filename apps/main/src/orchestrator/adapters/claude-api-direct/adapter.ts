import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  AdapterEventListener,
  AdapterName,
  ParsedEvent,
  SpawnContext,
  UsageEstimate,
} from "@prospero/shared";
import type { ToolContext } from "../../../mcp/tools.js";
import { createProjectsRepository } from "../../../projects/repository.js";
import { getAgentSandboxCwd } from "../../util/paths.js";
import { composeAgentSystemPrompt } from "../system-prompt-compose.js";
import { createSdkClient } from "./sdk-client.js";
import { runAgenticTurn, type LlmClient } from "./agentic-loop.js";
import { buildSdkTools, runTool, type SdkToolDef } from "./tool-bridge.js";
import { fsToolDefs, runFsTool, isFsTool, type FsSecCtx } from "./fs-tools.js";

// HTTP 429 from the Anthropic API = ITPM/OTPM rate limit (a transient
// token-bucket backoff, NOT the Max session/weekly limit). We detect it by the
// SDK's typed status (`err.status === 429`) — the SDK's RateLimitError extends
// APIError and carries `status: 429`. We deliberately match on the numeric
// status rather than `instanceof Anthropic.RateLimitError` so an injected fake
// client throwing `{ status: 429 }` is also recognized (tests inject the client
// to avoid the network).
const RATE_LIMIT_RESET_MS = 60_000;
const RATE_LIMIT_RETRY_SEC = 60;
const isRateLimitError = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { status?: unknown }).status === 429;

// Injectable seam for tests: lets the test pass a fake LlmClient so start()
// never opens a real Anthropic connection. Production omits it → createSdkClient.
export type ApiDirectDeps = {
  createClient?: (apiKey: string) => LlmClient;
};

// SDK-based adapter. Runs the CEO/agent loop in-process via the Messages API
// (1h prompt cache baked into createSdkClient) instead of spawning the `claude`
// CLI. Same public surface as ClaudeApiKeyLocalAdapter — only start()/sendInput
// internals differ (no child process; an in-process agentic loop).
export class ClaudeApiDirectAdapter implements AgentAdapter {
  readonly name: AdapterName = "claude-api-direct";
  readonly agentId: string;

  private readonly ctx: SpawnContext;
  private readonly deps: ApiDirectDeps;
  private started = false;
  private killed = false;
  private currentAction: string | null = null;
  private usage: UsageEstimate = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  private readonly eventListeners = new Set<AdapterEventListener<ParsedEvent>>();
  private readonly stderrListeners = new Set<AdapterEventListener<string>>();
  private readonly exitListeners = new Set<AdapterEventListener<number | null>>();

  // Built in start(), held for sendInput. The db handle is opened in start()
  // and closed in kill().
  private db: Database.Database | null = null;
  private client: LlmClient | null = null;
  private system = "";
  private tools: SdkToolDef[] = [];
  private toolCtx: ToolContext | null = null;
  private fsSecCtx: FsSecCtx | null = null;
  // V1: empty initial history. The first user turn arrives via sendInput; the
  // system prompt already carries digest/telos/memory (like a post-compaction
  // spawn). history.ts is intentionally NOT wired here.
  private messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  constructor(ctx: SpawnContext, deps: ApiDirectDeps = {}) {
    this.ctx = ctx;
    this.deps = deps;
    this.agentId = ctx.agent.id;
  }

  start(): Promise<void> {
    if (this.started) {
      throw new Error("Adapter already started; create a new instance to respawn");
    }
    if (this.ctx.apiKey === undefined) {
      throw new Error("claude-api-direct requires apiKey in SpawnContext");
    }
    this.started = true;
    const agent = this.ctx.agent;

    // The system prompt is composed by the SAME shared pure function the CLI
    // path (build-args) uses, so the SDK CEO gets a byte-identical prompt.
    this.system = composeAgentSystemPrompt(agent, {
      ...(this.ctx.narratedActive === true ? { narratedActive: true } : {}),
      ...(this.ctx.telosBlock !== undefined ? { telosBlock: this.ctx.telosBlock } : {}),
      ...(this.ctx.memoryBlock !== undefined ? { memoryBlock: this.ctx.memoryBlock } : {}),
      ...(this.ctx.projectContextBlock !== undefined
        ? { projectContextBlock: this.ctx.projectContextBlock }
        : {}),
      ...(this.ctx.instructionsBlock !== undefined
        ? { instructionsBlock: this.ctx.instructionsBlock }
        : {}),
      ...(this.ctx.capabilityBoundary !== undefined
        ? { capabilityBoundary: this.ctx.capabilityBoundary }
        : {}),
      ...(this.ctx.companyHasApprovedBusiness !== undefined
        ? { companyHasApprovedBusiness: this.ctx.companyHasApprovedBusiness }
        : {}),
    });

    // Tools = the dashboard tools visible to this agent (honoring its run policy)
    // plus the client-side fs tools when it holds fs-read. Mirrors the CLI: the
    // CLI gets Read/Glob/Grep for free from Claude Code, the SDK must supply them.
    this.tools = buildSdkTools(agent.capabilities, {
      canHire: agent.canHire,
      canAssign: agent.canAssign,
    }).concat(agent.capabilities.includes("fs-read") ? fsToolDefs() : []);

    // Open the DB handle for the in-process tool context. Closed in kill().
    this.db = new Database(this.ctx.dbPath);
    this.db.pragma("journal_mode = WAL");

    const eventsDir = this.ctx.eventsDir;
    const agentId = agent.id;
    const companyId = agent.companyId;
    // Replicate the MCP server's file-writing emit verbatim so the dashboard
    // tool handlers behave identically and the orchestrator's events-watcher is
    // unchanged (it already consumes JSON files dropped into eventsDir).
    this.toolCtx = {
      agentId,
      companyId,
      db: this.db,
      permissionsDir: this.ctx.permissionsDir,
      userDataDir: this.ctx.userDataDir ?? "",
      emit: (event) => {
        const filename = `${String(Date.now())}_${randomUUID()}.json`;
        try {
          writeFileSync(
            join(eventsDir, filename),
            JSON.stringify({ ...event, agentId, companyId }),
            "utf8",
          );
        } catch (e) {
          this.emitStderr(`[api-direct/emit] failed to write event file: ${(e as Error).message}`);
        }
      },
    };

    // Resolve the agent's allowed project paths the same way the CLI does
    // (apps/main/src/index.ts permission-watcher wiring): allowedProjects=[]
    // means ALL company projects; otherwise filter to the listed project ids.
    const projects = createProjectsRepository(this.db).listByCompany(companyId);
    const allowedProjectPaths =
      agent.allowedProjects.length === 0
        ? projects.map((p) => p.path)
        : projects.filter((p) => agent.allowedProjects.includes(p.id)).map((p) => p.path);

    this.fsSecCtx = {
      agent,
      allowedProjectPaths,
      agentCwd: this.ctx.cwd ?? getAgentSandboxCwd(this.ctx.userDataDir ?? "", agentId),
      userDataDir: this.ctx.userDataDir ?? "",
    };

    const createClient = this.deps.createClient ?? createSdkClient;
    this.client = createClient(this.ctx.apiKey);

    return Promise.resolve();
  }

  sendInput(content: string): void {
    if (this.killed) return;
    const client = this.client;
    const toolCtx = this.toolCtx;
    const fsSecCtx = this.fsSecCtx;
    if (client === null || toolCtx === null || fsSecCtx === null) return;
    // sendInput is sync-returning (mirrors the CLI adapter). Kick the async turn
    // with `void`; errors are funneled to ParsedEvents / onExit, not thrown.
    this.messages.push({ role: "user", content });
    void this.runTurn(client, toolCtx, fsSecCtx);
  }

  private async runTurn(
    client: LlmClient,
    toolCtx: ToolContext,
    fsSecCtx: FsSecCtx,
  ): Promise<void> {
    try {
      await runAgenticTurn({
        client,
        model: this.ctx.agent.model,
        system: this.system,
        tools: this.tools,
        messages: this.messages,
        runTool: (name, input) =>
          isFsTool(name) ? runFsTool(name, input, fsSecCtx) : runTool(name, input, toolCtx),
        onEvent: (e) => this.handleParsedEvent(e),
      });
    } catch (err) {
      if (isRateLimitError(err)) {
        // API 429 = transient ITPM/OTPM backoff. Emit a rate-limited event
        // (NOT an exit) so the orchestrator parks + retries — no inbox card,
        // unlike the Max session limit (scope: "api-rate-limit").
        this.handleParsedEvent({
          kind: "rate-limited",
          resetsAt: Date.now() + RATE_LIMIT_RESET_MS,
          retryAfterSec: RATE_LIMIT_RETRY_SEC,
          message: "api-rate-limit",
          scope: "api-rate-limit",
        });
        return;
      }
      // Any other failure: surface to stderr and exit non-zero so the
      // orchestrator's onExit recovery path runs (same as a CLI crash).
      this.emitStderr(`adapter-error: ${err instanceof Error ? err.message : String(err)}`);
      this.emitExit(1);
    }
  }

  onEvent(cb: AdapterEventListener<ParsedEvent>): () => void {
    this.eventListeners.add(cb);
    return (): void => {
      this.eventListeners.delete(cb);
    };
  }
  onStderr(cb: AdapterEventListener<string>): () => void {
    this.stderrListeners.add(cb);
    return (): void => {
      this.stderrListeners.delete(cb);
    };
  }
  onExit(cb: AdapterEventListener<number | null>): () => void {
    this.exitListeners.add(cb);
    return (): void => {
      this.exitListeners.delete(cb);
    };
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    if (this.db !== null) {
      try {
        this.db.close();
      } catch {
        /* best effort */
      }
      this.db = null;
    }
    this.emitExit(0);
  }

  isAlive(): boolean {
    return this.started && !this.killed;
  }

  getUsage(): UsageEstimate {
    return { ...this.usage };
  }
  getCurrentAction(): string | null {
    return this.currentAction;
  }

  private handleParsedEvent(event: ParsedEvent): void {
    if (event.kind === "turn-complete" && event.usage !== undefined) {
      this.usage.input += event.usage.input;
      this.usage.output += event.usage.output;
      this.usage.cache_creation += event.usage.cache_creation;
      this.usage.cache_read += event.usage.cache_read;
    }
    // Track the current action from the latest tool-use, mirroring api-key-local's
    // intent (it tracks currentAction; for the SDK path the freshest signal is the
    // tool the agent just invoked). Cleared on turn-complete.
    if (event.kind === "assistant-message") {
      const lastTool = [...event.blocks].reverse().find((b) => b.kind === "tool-use");
      this.currentAction =
        lastTool !== undefined && lastTool.kind === "tool-use" ? lastTool.name : null;
    } else if (event.kind === "turn-complete") {
      this.currentAction = null;
    }
    for (const cb of this.eventListeners) cb(event);
  }
  private emitStderr(line: string): void {
    for (const cb of this.stderrListeners) cb(line);
  }
  private emitExit(code: number | null): void {
    for (const cb of this.exitListeners) cb(code);
  }
}
