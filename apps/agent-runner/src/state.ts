import type { WireCredentials } from "@prospero/shared";
import type { ClaudeProcess } from "./claude-process.js";
import type { AgentSandbox } from "./sandbox.js";
import type { McpListener } from "./mcp-mux.js";

/** A spawned agent the runner is managing. */
export type RunningAgent = {
  readonly child: ClaudeProcess;
  readonly sandbox: AgentSandbox;
  readonly mcp: McpListener;
};

/** Mutable state shared across the runner's wire handlers. */
export type RunnerState = {
  /** Epoch ms when the runner process started. */
  readonly startedAt: number;
  /** Credentials from the handshake; null until the handshake completes. */
  credentials: WireCredentials | null;
  /** Live agents, keyed by agentId. */
  readonly agents: Map<string, RunningAgent>;
};

/** Create a fresh runner state. `now` is injectable for deterministic tests. */
export const createRunnerState = (now: number = Date.now()): RunnerState => ({
  startedAt: now,
  credentials: null,
  agents: new Map(),
});
