import { WireServer, type WireTransport } from "@prospero/shared";
import { createRunnerState, type RunnerState } from "./state.js";
import { spawnClaude as realSpawnClaude, type ClaudeSpawner } from "./claude-process.js";
import { prepareAgentSandbox } from "./sandbox.js";
import type { AgentSandbox } from "./sandbox.js";
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
};

/**
 * Wires a WireServer over the given transport and registers the runner's
 * request handlers. The server is live as soon as this returns.
 */
export const createRunner = (transport: WireTransport, deps: RunnerDeps = {}): Runner => {
  const state = createRunnerState();
  const server = new WireServer(transport);
  const spawnClaude = deps.spawnClaude ?? realSpawnClaude;
  const prepareSandbox = deps.prepareSandbox ?? ((agentId: string) => prepareAgentSandbox(agentId));

  server.handle("handshake", (params) => handleHandshake(params, state));
  server.handle("health", () => handleHealth(state));
  server.handle("spawn", (params) =>
    handleSpawn(params, {
      state,
      notify: (method, notifyParams) => server.notify(method, notifyParams),
      spawnClaude,
      prepareSandbox,
    }),
  );
  server.handle("stdin-write", (params) => handleStdinWrite(params, state));
  server.handle("kill", (params) => handleKill(params, state));
  return { server, state };
};
