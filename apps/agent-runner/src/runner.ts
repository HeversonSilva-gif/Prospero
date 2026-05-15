import { WireServer, type WireTransport } from "@dashboard-agent/shared";
import { createRunnerState, type RunnerState } from "./state.js";
import { handleHandshake } from "./handlers/handshake.js";
import { handleHealth } from "./handlers/health.js";

export type Runner = {
  readonly server: WireServer;
  readonly state: RunnerState;
};

/**
 * Wires a WireServer over the given transport and registers the runner's
 * request handlers. The server is live as soon as this returns.
 */
export const createRunner = (transport: WireTransport): Runner => {
  const state = createRunnerState();
  const server = new WireServer(transport);
  server.handle("handshake", (params) => handleHandshake(params, state));
  server.handle("health", () => handleHealth(state));
  return { server, state };
};
