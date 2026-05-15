import { spawn } from "node:child_process";
import {
  WireClient,
  WIRE_PROTOCOL_VERSION,
  type WireTransport,
  type HandshakeResult,
  type SpawnResult,
  type HealthResult,
} from "@prospero/shared";
import { buildTransportCommand } from "./transport-command.js";
import { ChildProcessWireTransport } from "./child-transport.js";
import { DEFAULT_LOCAL_DOCKER_CONFIG } from "./config.js";

/** Per-agent sinks the connection manager fans inbound notifications into. */
export type RemoteAgentCallbacks = {
  onStdout: (line: string) => void;
  onStderr: (line: string) => void;
  onExit: (code: number | null) => void;
  onMcpOpen: () => void;
  onMcpData: (line: string) => void;
  onMcpClose: () => void;
};

export type SpawnAgentRequest = {
  agentId: string;
  /** claude argv built host-side, minus the MCP triplet (the runner appends it). */
  args: string[];
  env?: Record<string, string>;
  oauthToken: string;
  callbacks: RemoteAgentCallbacks;
};

export type RemoteConnectionDeps = {
  /**
   * Builds the wire transport — a spawned docker/ssh child in production, an
   * in-memory pair in tests. Called once, on the first connection.
   */
  createTransport: () => WireTransport;
};

const CLIENT_NAME = "prospero-orchestrator";
const CLIENT_VERSION = "0.0.0";

/**
 * Owns the single wire connection to one agent-runner container and multiplexes
 * every remote agent over it (design §3.2). Lazily connects + handshakes on the
 * first spawnAgent; routes inbound stdout/stderr/exit/mcp-* notifications to the
 * right agent by agentId. A transport close fails every live agent.
 */
export class RemoteConnectionManager {
  private readonly createTransport: () => WireTransport;
  private client: WireClient | null = null;
  private connecting: Promise<void> | null = null;
  private readonly agents = new Map<string, RemoteAgentCallbacks>();

  constructor(deps: RemoteConnectionDeps) {
    this.createTransport = deps.createTransport;
  }

  /** True once the agent has been spawned and has not yet exited. */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Spawns a claude process in the remote container; resolves with its pid. */
  async spawnAgent(req: SpawnAgentRequest): Promise<SpawnResult> {
    await this.ensureConnection(req.oauthToken);
    const client = this.client;
    if (client === null) throw new Error("remote connection lost");
    this.agents.set(req.agentId, req.callbacks);
    try {
      return await client.request<SpawnResult>("spawn", {
        agentId: req.agentId,
        args: req.args,
        ...(req.env !== undefined ? { env: req.env } : {}),
      });
    } catch (e) {
      this.agents.delete(req.agentId);
      throw e;
    }
  }

  /** Writes one JSONL line to the agent's claude stdin. Fire-and-forget. */
  sendStdin(agentId: string, line: string): void {
    void this.client?.request("stdin-write", { agentId, line }).catch(() => undefined);
  }

  /** Kills the agent's claude process. The runner's exit notification cleans up. */
  killAgent(agentId: string): void {
    void this.client?.request("kill", { agentId }).catch(() => undefined);
  }

  /** Sends one MCP JSON-RPC line from the host relay into the agent's bridge. */
  sendMcpData(agentId: string, line: string): void {
    this.client?.notify("mcp-data", { agentId, line });
  }

  /** Queries runner health over the live connection. */
  async health(): Promise<HealthResult> {
    if (this.client === null) throw new Error("remote runner not connected");
    return this.client.request<HealthResult>("health");
  }

  private ensureConnection(oauthToken: string): Promise<void> {
    if (this.connecting !== null) return this.connecting;
    const raw = this.createTransport();
    // Fan-out transport: WireClient.onClose is last-registration-wins, but the
    // manager also needs close — so the raw close invokes both.
    const transport: WireTransport = {
      send: (data) => raw.send(data),
      onData: (handler) => raw.onData(handler),
      onClose: (clientHandler) => {
        raw.onClose(() => {
          this.handleClose();
          clientHandler();
        });
      },
    };
    const client = new WireClient(transport);
    this.client = client;
    this.registerNotificationRoutes(client);
    this.connecting = client
      .request<HandshakeResult>("handshake", {
        protocolVersion: WIRE_PROTOCOL_VERSION,
        client: CLIENT_NAME,
        clientVersion: CLIENT_VERSION,
        credentials: { kind: "oauth", oauthToken },
      })
      .then((result) => {
        if (result.protocolVersion !== WIRE_PROTOCOL_VERSION) {
          throw new Error(
            `remote runner speaks protocol ${String(result.protocolVersion)}, ` +
              `expected ${String(WIRE_PROTOCOL_VERSION)}`,
          );
        }
      });
    return this.connecting;
  }

  private registerNotificationRoutes(client: WireClient): void {
    client.onNotification("stdout", (params) => {
      const d = params as { agentId?: unknown; line?: unknown };
      if (typeof d.agentId !== "string" || typeof d.line !== "string") return;
      this.agents.get(d.agentId)?.onStdout(d.line);
    });
    client.onNotification("stderr", (params) => {
      const d = params as { agentId?: unknown; line?: unknown };
      if (typeof d.agentId !== "string" || typeof d.line !== "string") return;
      this.agents.get(d.agentId)?.onStderr(d.line);
    });
    client.onNotification("exit", (params) => {
      const d = params as { agentId?: unknown; code?: unknown };
      if (typeof d.agentId !== "string") return;
      this.agents.get(d.agentId)?.onExit(typeof d.code === "number" ? d.code : null);
      this.agents.delete(d.agentId);
    });
    client.onNotification("mcp-open", (params) => {
      const d = params as { agentId?: unknown };
      if (typeof d.agentId !== "string") return;
      this.agents.get(d.agentId)?.onMcpOpen();
    });
    client.onNotification("mcp-data", (params) => {
      const d = params as { agentId?: unknown; line?: unknown };
      if (typeof d.agentId !== "string" || typeof d.line !== "string") return;
      this.agents.get(d.agentId)?.onMcpData(d.line);
    });
    client.onNotification("mcp-close", (params) => {
      const d = params as { agentId?: unknown };
      if (typeof d.agentId !== "string") return;
      this.agents.get(d.agentId)?.onMcpClose();
    });
  }

  private handleClose(): void {
    for (const cb of this.agents.values()) cb.onExit(null);
    this.agents.clear();
    this.client = null;
    this.connecting = null;
  }
}

// Spawns the docker/ssh child whose stdio carries the wire protocol. stderr is
// inherited so docker/ssh launch failures surface in the Electron main log.
// Not unit-tested (no Docker on the build machine) — verified by the PR-E smoke.
const createProductionTransport = (): WireTransport => {
  const { command, args } = buildTransportCommand(DEFAULT_LOCAL_DOCKER_CONFIG);
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  return new ChildProcessWireTransport(child);
};

let singleton: RemoteConnectionManager | null = null;

/** The process-wide remote connection manager — one wire connection per host. */
export const getRemoteConnectionManager = (): RemoteConnectionManager => {
  singleton ??= new RemoteConnectionManager({ createTransport: createProductionTransport });
  return singleton;
};
