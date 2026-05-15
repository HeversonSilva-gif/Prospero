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
  Array<{ threadId: string; content: string; sender: Sender }>
>();

export const enqueueOrPark = (
  agent: Agent,
  router: Router,
  threadId: string,
  content: string,
  sender: Sender,
): void => {
  if (agent.status === "paused" || agent.status === "terminated") {
    const list = pauseBacklog.get(agent.id) ?? [];
    list.push({ threadId, content, sender });
    pauseBacklog.set(agent.id, list);
    return;
  }
  router.enqueue(agent.id, threadId, content, sender);
};

export const drainPausedBacklog = (agentId: string, router: Router): number => {
  const parked = pauseBacklog.get(agentId) ?? [];
  pauseBacklog.delete(agentId);
  for (const m of parked) router.enqueue(agentId, m.threadId, m.content, m.sender);
  return parked.length;
};
