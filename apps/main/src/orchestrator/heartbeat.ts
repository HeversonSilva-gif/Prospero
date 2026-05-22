import type Database from "better-sqlite3";
import type { AgentsRepository } from "../agents/repository.js";
import type { InboxRepository } from "../inbox/repository.js";

export type StaleAgent = { id: string; companyId: string; name: string };

// Detects agents marked working/thinking whose last activity_event is older
// than thresholdMs. Falls back to agents.updated_at when no activity_events
// exist for the agent (e.g. fresh spawn that crashed before emitting any
// event). Excludes idle/paused/error/terminated/waiting agents — those are
// either intentionally not running or already flagged.
const SQL = `
  SELECT a.id AS id, a.company_id AS companyId, a.name AS name
  FROM agents a
  WHERE a.status IN ('working', 'thinking')
    AND COALESCE(
      (SELECT MAX(created_at) FROM activity_events WHERE agent_id = a.id),
      a.updated_at
    ) < @cutoff
`;

export const scanStaleAgents = (db: Database.Database, thresholdMs: number): StaleAgent[] => {
  const cutoff = Date.now() - thresholdMs;
  return db.prepare(SQL).all({ cutoff }) as StaleAgent[];
};

export type HeartbeatDeps = {
  db: Database.Database;
  agents: AgentsRepository;
  inbox: InboxRepository;
  broadcastInbox: (companyId: string) => void;
  thresholdMs: number;
  /**
   * True when the agent's claude process is currently alive. An agent that is
   * stale-by-activity but still alive is mid long-running turn (e.g. running a
   * test suite or reading a large repo) — it emits no activity_event for
   * minutes but is NOT unresponsive. Only genuinely dead processes (status
   * stuck at working/thinking after the child exited) should be flagged. This
   * matches the heartbeat's original intent ("fresh spawn that crashed").
   */
  isAlive: (agentId: string) => boolean;
};

export const tickHeartbeat = (deps: HeartbeatDeps): number => {
  const stale = scanStaleAgents(deps.db, deps.thresholdMs);
  let flagged = 0;
  for (const a of stale) {
    // Alive but quiet → legitimate long turn, not unresponsive. Skip.
    if (deps.isAlive(a.id)) continue;
    deps.agents.updateStatus(a.id, { status: "error", currentAction: null });
    // De-dup: a stuck-but-dead agent can re-enter the scan if its status
    // oscillates; don't post a fresh card while an unread one is recent.
    const recent = deps.inbox.findRecentUnread({
      companyId: a.companyId,
      agentId: a.id,
      kind: "agent_unresponsive",
      withinMs: deps.thresholdMs,
    });
    if (recent === null) {
      deps.inbox.create({
        companyId: a.companyId,
        kind: "agent_unresponsive",
        actorId: a.id,
        title: `Agent ${a.name} appears unresponsive`,
        preview: `No activity for over ${String(Math.round(deps.thresholdMs / 60_000))} minutes.`,
        requiresAction: false,
        payloadJson: null,
      });
      deps.broadcastInbox(a.companyId);
    }
    flagged += 1;
  }
  return flagged;
};

export const startHeartbeat = (deps: HeartbeatDeps, intervalMs = 60_000): (() => void) => {
  const timer = setInterval(() => {
    try {
      tickHeartbeat(deps);
    } catch {
      // best-effort — heartbeat must not crash main.
    }
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
};
