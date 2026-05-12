import type { AgentAdapter, AdapterName, ParsedEvent, SpawnContext } from "@dashboard-agent/shared";
import { DEFAULT_ADAPTER_NAME } from "@dashboard-agent/shared";
import { createAdapter } from "./adapters/index.js";

// Re-exports for callers that gradually migrate to direct imports.
export { buildClaudeArgs } from "./adapters/claude-oauth-local/build-args.js";
export { getAgentSandboxCwd } from "./util/paths.js";

// Hard cap per Anthropic ToS — single-user OAuth license tolerates ~4 parallel sessions
// safely. Attempting to spawn a 5th throws a clear error. Future budget enforcement
// (M8) refines this.
export const MAX_CONCURRENT_AGENTS = 4;

const adapters = new Map<string, AgentAdapter>();

export const getAdapter = (agentId: string): AgentAdapter | undefined => adapters.get(agentId);

export const removeAdapter = (agentId: string): void => {
  adapters.delete(agentId);
};

export const activeAdapterCount = (): number => {
  let count = 0;
  for (const a of adapters.values()) {
    if (a.isAlive()) count++;
  }
  return count;
};

export type EnsureAdapterOptions = SpawnContext;

export type AdapterCallbacks = {
  onEvent: (event: ParsedEvent) => void;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null) => void;
};

export const ensureAdapter = async (
  opts: EnsureAdapterOptions,
  callbacks: AdapterCallbacks,
): Promise<AgentAdapter> => {
  const existing = adapters.get(opts.agent.id);
  if (existing !== undefined && existing.isAlive()) return existing;

  if (activeAdapterCount() >= MAX_CONCURRENT_AGENTS) {
    throw new Error(
      `Max concurrent agents (${String(MAX_CONCURRENT_AGENTS)}) reached. Kill one before spawning a new agent.`,
    );
  }

  const name: AdapterName = (opts.agent.adapterName as AdapterName) ?? DEFAULT_ADAPTER_NAME;
  const adapter = createAdapter(name, opts);
  adapter.onEvent(callbacks.onEvent);
  if (callbacks.onStderr !== undefined) adapter.onStderr(callbacks.onStderr);
  if (callbacks.onExit !== undefined) adapter.onExit(callbacks.onExit);
  adapters.set(opts.agent.id, adapter);
  await adapter.start();
  return adapter;
};

export const restartAdapter = async (
  agentId: string,
  opts: EnsureAdapterOptions,
  callbacks: AdapterCallbacks,
): Promise<AgentAdapter | null> => {
  const existing = adapters.get(agentId);
  if (existing === undefined || !existing.isAlive()) return null;
  existing.kill();
  adapters.delete(agentId);
  return ensureAdapter(opts, callbacks);
};

// --- Backwards-compatible shims for orchestrator-handlers.ts during migration ---
// Task 16 migrates the handler callers; Task 17 deletes this section.

export type AgentRunner = {
  agentId: string;
  send(message: string): void;
  kill(): void;
  isAlive(): boolean;
};

export type RunnerCallbacks = {
  onEvent: (event: ParsedEvent) => void;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null) => void;
  onError?: (err: Error) => void;
};

export type SpawnOptions = SpawnContext;
export type EnsureRunnerOptions = SpawnOptions;

const adapterToRunner = (a: AgentAdapter): AgentRunner => ({
  agentId: a.agentId,
  send: (m: string): void => a.sendInput(m),
  kill: (): void => {
    a.kill();
    adapters.delete(a.agentId);
  },
  isAlive: (): boolean => a.isAlive(),
});

export const getRunner = (agentId: string): AgentRunner | undefined => {
  const a = adapters.get(agentId);
  return a !== undefined ? adapterToRunner(a) : undefined;
};

export const registerRunner = (_runner: AgentRunner): void => {
  // No-op shim: adapter registry replaces manual registration.
  // The Map is populated by ensureAdapter directly.
};

export const removeRunner = (agentId: string): void => {
  adapters.delete(agentId);
};

export const activeRunnerCount = (): number => activeAdapterCount();

export const spawnAgent = (opts: SpawnOptions, cb: RunnerCallbacks): AgentRunner => {
  // Synchronous shim used by current orchestrator-handlers. Schedules the async start
  // but returns the runner immediately. ensureAdapter handles the actual lifecycle.
  const adapterCallbacks: AdapterCallbacks = { onEvent: cb.onEvent };
  if (cb.onStderr !== undefined) adapterCallbacks.onStderr = cb.onStderr;
  if (cb.onExit !== undefined) adapterCallbacks.onExit = cb.onExit;
  void ensureAdapter(opts, adapterCallbacks).catch((err: Error) => {
    cb.onError?.(err);
  });
  return {
    agentId: opts.agent.id,
    send(message: string): void {
      const a = adapters.get(opts.agent.id);
      a?.sendInput(message);
    },
    kill(): void {
      const a = adapters.get(opts.agent.id);
      a?.kill();
      adapters.delete(opts.agent.id);
    },
    isAlive(): boolean {
      const a = adapters.get(opts.agent.id);
      return a?.isAlive() ?? false;
    },
  };
};

export const ensureRunner = (opts: SpawnOptions, cb: RunnerCallbacks): AgentRunner => {
  const existing = getRunner(opts.agent.id);
  if (existing !== undefined && existing.isAlive()) return existing;
  return spawnAgent(opts, cb);
};
