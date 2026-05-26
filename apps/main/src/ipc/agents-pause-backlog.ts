// In-memory backlog for messages received while an agent is paused or
// terminated. Wiped on process restart — paused agents are short-lived
// intent and parking is best-effort.
//
// Kept in a tiny standalone module so the parking helper can be imported by
// both orchestrator-handlers (production path) and unit tests (no IPC bootstrap).

import type { Agent } from "@prospero/shared";
import type { Router, Sender } from "../orchestrator/router.js";

export const pauseBacklog = new Map<
  string,
  Array<{ threadId: string; content: string; sender: Sender; messageId: string | null }>
>();

export const enqueueOrPark = (
  agent: Agent,
  router: Router,
  threadId: string,
  content: string,
  sender: Sender,
  messageId: string | null = null,
): void => {
  if (agent.status === "paused" || agent.status === "terminated") {
    const list = pauseBacklog.get(agent.id) ?? [];
    list.push({ threadId, content, sender, messageId });
    pauseBacklog.set(agent.id, list);
    return;
  }
  router.enqueue(agent.id, threadId, content, sender, messageId);
};

export const drainPausedBacklog = (agentId: string, router: Router): number => {
  const parked = pauseBacklog.get(agentId) ?? [];
  pauseBacklog.delete(agentId);
  for (const m of parked) router.enqueue(agentId, m.threadId, m.content, m.sender, m.messageId);
  return parked.length;
};

export interface KillableAdapter {
  isAlive(): boolean;
  kill(): void;
}

export interface PauseStopDeps {
  getAdapter: (agentId: string) => KillableAdapter | undefined;
  removeAdapter: (agentId: string) => void;
  pause: (agentId: string, reason?: string) => void;
}

// Pauses an agent AND stops its running turn. Pausing alone only parks new
// messages (enqueueOrPark) — a turn already in flight keeps running and keeps
// spending. So we kill the live process first (and remove it from the lifecycle
// Map so the onExit guard treats this as an intentional kill, leaving the status
// as "paused" rather than overwriting it with "error"). Returns whether a live
// process was actually killed. The DB status change (pause) is the caller's
// source of truth; broadcasting is left to the caller (UI concern).
export const pauseAndStopAgent = (
  agentId: string,
  reason: string | undefined,
  deps: PauseStopDeps,
): boolean => {
  const adapter = deps.getAdapter(agentId);
  const wasAlive = adapter !== undefined && adapter.isAlive();
  if (wasAlive) {
    adapter.kill();
    deps.removeAdapter(agentId);
  }
  deps.pause(agentId, reason);
  return wasAlive;
};
