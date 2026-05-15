import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WireServer, type WireTransport } from "@prospero/shared";
import { createRunnerState, type RunnerState } from "./state.js";
import { spawnClaude as realSpawnClaude, type ClaudeSpawner } from "./claude-process.js";
import { prepareAgentSandbox } from "./sandbox.js";
import type { AgentSandbox } from "./sandbox.js";
import { createMcpListener as realCreateMcpListener } from "./mcp-mux.js";
import type { McpListener } from "./mcp-mux.js";
import { handleHandshake } from "./handlers/handshake.js";
import { handleHealth } from "./handlers/health.js";
import { handleSpawn } from "./handlers/spawn.js";
import { handleStdinWrite } from "./handlers/stdin-write.js";
import { handleKill } from "./handlers/kill.js";

export type Runner = {
  readonly server: WireServer;
  readonly state: RunnerState;
};

/** Injectable dependencies — overridden in tests with fakes. */
export type RunnerDeps = {
  spawnClaude?: ClaudeSpawner;
  prepareSandbox?: (agentId: string) => AgentSandbox;
  createMcpListener?: (agentId: string) => Promise<McpListener>;
  mcpBridgePath?: string;
};

// The bundled mcp-bridge sits next to index.js in dist/ (and in the image).
const defaultBridgePath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "mcp-bridge.js");

/**
 * Wires a WireServer over the given transport and registers the runner's
 * request handlers. The server is live as soon as this returns.
 */
export const createRunner = (transport: WireTransport, deps: RunnerDeps = {}): Runner => {
  const state = createRunnerState();
  const server = new WireServer(transport);
  const spawnClaude = deps.spawnClaude ?? realSpawnClaude;
  const prepareSandbox = deps.prepareSandbox ?? ((agentId: string) => prepareAgentSandbox(agentId));
  const notify = (method: string, params: unknown): void => server.notify(method, params);
  const createMcpListener =
    deps.createMcpListener ?? ((agentId: string) => realCreateMcpListener(agentId, { notify }));
  const mcpBridgePath = deps.mcpBridgePath ?? defaultBridgePath();

  server.handle("handshake", (params) => handleHandshake(params, state));
  server.handle("health", () => handleHealth(state));
  server.handle("spawn", (params) =>
    handleSpawn(params, {
      state,
      notify,
      spawnClaude,
      prepareSandbox,
      createMcpListener,
      mcpBridgePath,
    }),
  );
  server.handle("stdin-write", (params) => handleStdinWrite(params, state));
  server.handle("kill", (params) => handleKill(params, state));

  // Host → bridge: write inbound MCP lines into the target agent's listener.
  server.onNotification("mcp-data", (params) => {
    const data = params as { agentId?: unknown; line?: unknown };
    if (typeof data.agentId !== "string" || typeof data.line !== "string") return;
    state.agents.get(data.agentId)?.mcp.writeToBridge(data.line);
  });

  return { server, state };
};
