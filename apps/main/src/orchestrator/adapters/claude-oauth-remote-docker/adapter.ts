import type {
  AgentAdapter,
  AdapterEventListener,
  AdapterName,
  ParsedEvent,
  SpawnContext,
  UsageEstimate,
} from "@prospero/shared";
import { buildClaudeArgs } from "../claude-oauth-local/build-args.js";
import { parseStreamLine } from "../claude-oauth-local/stream-parser.js";
import { resolveMcpServerPath } from "../../mcp-handshake.js";
import { getRemoteConnectionManager, type RemoteConnectionManager } from "./connection-manager.js";
import { McpRelay, type McpServerSpawner } from "./mcp-relay.js";

/** Injectable dependencies — overridden in tests. */
export type RemoteAdapterDeps = {
  connectionManager?: RemoteConnectionManager;
  spawnMcpServer?: McpServerSpawner;
};

/**
 * Runs an agent's `claude` process inside a remote Docker container. Per-agent
 * (one instance per agentId); translates the AgentAdapter surface into wire
 * messages over the shared RemoteConnectionManager, and runs a per-agent MCP
 * relay so the container's tools reach the host's dashboard MCP server.
 */
export class ClaudeRemoteDockerAdapter implements AgentAdapter {
  readonly name: AdapterName = "claude-oauth-remote-docker";
  readonly agentId: string;

  private readonly ctx: SpawnContext;
  private readonly connectionManager: RemoteConnectionManager;
  private readonly spawnMcpServer: McpServerSpawner | undefined;
  private started = false;
  private alive = false;
  private relay: McpRelay | null = null;
  private currentAction: string | null = null;
  private usage: UsageEstimate = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  private readonly eventListeners = new Set<AdapterEventListener<ParsedEvent>>();
  private readonly stderrListeners = new Set<AdapterEventListener<string>>();
  private readonly exitListeners = new Set<AdapterEventListener<number | null>>();

  constructor(ctx: SpawnContext, deps: RemoteAdapterDeps = {}) {
    this.ctx = ctx;
    this.agentId = ctx.agent.id;
    this.connectionManager = deps.connectionManager ?? getRemoteConnectionManager();
    this.spawnMcpServer = deps.spawnMcpServer;
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("Adapter already started; create a new instance to respawn");
    }
    this.started = true;
    if (this.ctx.oauthToken === undefined) {
      throw new Error("claude-oauth-remote-docker requires oauthToken in SpawnContext");
    }
    // null mcpConfigPath: the runner appends the MCP triplet with the
    // container-local mcp.json path (design §4.3).
    const args = buildClaudeArgs(this.ctx.agent, null, {
      ...(this.ctx.narratedActive === true ? { narratedActive: true } : {}),
    });
    const mcpServerJsPath = resolveMcpServerPath(this.ctx.mcpServerJsPath);
    const mcpEnv = {
      AGENT_ID: this.ctx.agent.id,
      COMPANY_ID: this.ctx.agent.companyId,
      DB_PATH: this.ctx.dbPath,
      PERMISSIONS_DIR: this.ctx.permissionsDir,
      EVENTS_DIR: this.ctx.eventsDir,
    };
    try {
      await this.connectionManager.spawnAgent({
        agentId: this.agentId,
        args,
        oauthToken: this.ctx.oauthToken,
        callbacks: {
          onStdout: (line) => {
            const parsed = parseStreamLine(line);
            if (parsed !== null) this.handleParsedEvent(parsed);
          },
          onStderr: (line) => this.emitStderr(line),
          onExit: (code) => {
            this.alive = false;
            this.relay?.stop();
            this.relay = null;
            this.emitExit(code);
          },
          onMcpOpen: () => {
            this.relay?.stop();
            this.relay = new McpRelay({
              agentId: this.agentId,
              mcpServerJsPath,
              env: mcpEnv,
              sendMcpData: (id, line) => this.connectionManager.sendMcpData(id, line),
              ...(this.spawnMcpServer !== undefined ? { spawnMcpServer: this.spawnMcpServer } : {}),
            });
            this.relay.start();
          },
          onMcpData: (line) => this.relay?.handleData(line),
          onMcpClose: () => {
            this.relay?.stop();
            this.relay = null;
          },
        },
      });
    } catch (e) {
      this.alive = false;
      throw e;
    }
    this.alive = true;
  }

  sendInput(text: string): void {
    if (!this.alive) return;
    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    });
    this.connectionManager.sendStdin(this.agentId, payload + "\n");
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
    this.alive = false;
    this.connectionManager.killAgent(this.agentId);
    this.relay?.stop();
    this.relay = null;
  }

  isAlive(): boolean {
    return this.alive;
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
    for (const cb of this.eventListeners) cb(event);
  }

  private emitStderr(line: string): void {
    for (const cb of this.stderrListeners) cb(line);
  }

  private emitExit(code: number | null): void {
    for (const cb of this.exitListeners) cb(code);
  }
}
