import type { AgentAdapter, AdapterName, ParsedEvent, SpawnContext } from "@prospero/shared";
import { DEFAULT_ADAPTER_NAME } from "@prospero/shared";
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

/** Agent ids that currently hold a live (or registered) adapter. */
export const listAdapterAgentIds = (): string[] => Array.from(adapters.keys());

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

  // OAuth Max ToS caps parallel sessions at 4 — local and remote OAuth agents
  // both count (m10 design §3.2). API key has no such cap (Anthropic rate limit
  // handles it). The agent.adapterName carries the mode selected at creation.
  const adapterName = opts.agent.adapterName as string | undefined;
  const isOauth =
    adapterName === "claude-oauth-local" ||
    adapterName === "claude-oauth-remote-docker" ||
    adapterName === undefined;
  if (isOauth && activeAdapterCount() >= MAX_CONCURRENT_AGENTS) {
    throw new Error(
      `Max concurrent OAuth agents (${String(MAX_CONCURRENT_AGENTS)}) reached. ` +
        `Kill one before spawning a new agent, or switch to API key mode in Settings.`,
    );
  }

  // agent.adapterName is set at creation time (see agents.create + hire pipeline).
  // Migration 0004 defaults the column to 'claude-oauth-local', so even legacy
  // rows pre-PR-D land on OAuth.
  const name: AdapterName =
    (opts.agent.adapterName as AdapterName | undefined) ?? DEFAULT_ADAPTER_NAME;
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
