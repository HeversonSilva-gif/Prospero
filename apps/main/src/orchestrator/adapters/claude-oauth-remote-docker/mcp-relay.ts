import { spawn } from "node:child_process";
import { LineFramer } from "@prospero/shared";

/** The minimal slice of a spawned MCP server process the relay drives. */
export type McpServerProcess = {
  readonly stdin: NodeJS.WritableStream | null;
  readonly stdout: NodeJS.ReadableStream | null;
  kill(): void;
  on(event: "exit", listener: (code: number | null) => void): void;
};

/** Spawns the host `mcp/server.js` for one agent. Injectable for tests. */
export type McpServerSpawner = (
  mcpServerJsPath: string,
  env: Record<string, string>,
) => McpServerProcess;

export type McpRelayDeps = {
  agentId: string;
  /** Absolute path of the bundled host MCP server entry (dist/mcp/server.js). */
  mcpServerJsPath: string;
  /** AGENT_ID / COMPANY_ID / DB_PATH / PERMISSIONS_DIR / EVENTS_DIR. */
  env: Record<string, string>;
  /** Sends one newline-terminated MCP line back to the runner. */
  sendMcpData: (agentId: string, line: string) => void;
  spawnMcpServer?: McpServerSpawner;
};

// In Electron's main process, process.execPath is electron.exe; ELECTRON_RUN_AS_NODE
// makes it behave as plain Node for the child (mirrors orchestrator/mcp-config.ts).
const realSpawnMcpServer: McpServerSpawner = (mcpServerJsPath, env) => {
  const isElectronBinary = /electron(\.exe)?$/i.test(process.execPath);
  return spawn(process.execPath, [mcpServerJsPath], {
    env: {
      ...process.env,
      ...env,
      ...(isElectronBinary ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
};

/**
 * Per-agent MCP relay. When a remote agent's claude launches its MCP bridge,
 * the host spawns the real `mcp/server.js` here (host-side, direct SQLite
 * access) and ferries JSON-RPC lines between it and the runner's wire channel
 * (design §6). runner -> host mcp-data lines arrive newline-stripped; host ->
 * runner lines must carry the newline the bridge writes verbatim to claude.
 */
export class McpRelay {
  private readonly deps: McpRelayDeps;
  private server: McpServerProcess | null = null;
  private readonly framer = new LineFramer();

  constructor(deps: McpRelayDeps) {
    this.deps = deps;
  }

  /** Spawns the host MCP server and pipes its stdout back to the runner. */
  start(): void {
    if (this.server !== null) return;
    const spawnFn = this.deps.spawnMcpServer ?? realSpawnMcpServer;
    const server = spawnFn(this.deps.mcpServerJsPath, this.deps.env);
    this.server = server;
    server.stdout?.setEncoding("utf8");
    server.stdout?.on("data", (chunk: string) => {
      for (const line of this.framer.push(chunk)) {
        this.deps.sendMcpData(this.deps.agentId, line + "\n");
      }
    });
  }

  /** Writes one inbound MCP line (from the runner) to the server's stdin. */
  handleData(line: string): void {
    const framed = line.endsWith("\n") ? line : line + "\n";
    this.server?.stdin?.write(framed);
  }

  /** Kills the host MCP server. */
  stop(): void {
    this.server?.kill();
    this.server = null;
  }
}
