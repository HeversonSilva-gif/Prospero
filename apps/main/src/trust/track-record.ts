import type Database from "better-sqlite3";
import type { TrackRecord } from "@prospero/shared";

// M14 PR-A — collectTrackRecord. Read-only — all queries are SELECT against
// existing tables (M13 goals/goal_criteria, M7.5 approvals, M14 trust_events).
// No new state is materialized; calling this twice in a row is identical.

// Default trust window: 30 days. Demotions and verification failures inside
// this window count against the agent. Tunable in PR-A — start conservative.
export const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type CollectTrackRecordOpts = {
  /** Defaults to DEFAULT_WINDOW_MS. */
  windowMs?: number;
  /** Defaults to Date.now(). Test seam. */
  now?: number;
};

export const collectTrackRecord = (
  db: Database.Database,
  agentId: string,
  opts: CollectTrackRecordOpts = {},
): TrackRecord => {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const since = now - windowMs;

  // 1. Verified outcomes — goals reached 'achieved' owned by this agent.
  const verifiedOutcomes = (
    db
      .prepare("SELECT COUNT(*) AS n FROM goals WHERE owner_agent_id = ? AND status = 'achieved'")
      .get(agentId) as { n: number }
  ).n;

  // 2. ISC first-pass rate — across all goals the agent owns (any status),
  //    of criteria that reached a terminal status (passed/failed), what
  //    fraction passed on the first attempt.
  const isc = db
    .prepare(
      `SELECT
         SUM(CASE WHEN gc.status = 'passed' AND gc.attempts = 1 THEN 1 ELSE 0 END) AS first_pass,
         SUM(CASE WHEN gc.status IN ('passed','failed') THEN 1 ELSE 0 END)         AS terminal
       FROM goal_criteria gc
       JOIN goals g ON g.id = gc.goal_id
       WHERE g.owner_agent_id = ?
         -- Only DETERMINISTIC criteria: judgment ISCs are set via setJudgment
         -- (attempts stays 0) so they can never be a "first pass" and would
         -- otherwise depress the rate (audit 2026-06-03 #11).
         AND gc.kind = 'deterministic'
         -- Windowed (audit 2026-06-03 #4): old flakiness must not keep an agent
         -- below the autonomo bar forever. Mirrors verificationFailures below.
         AND gc.updated_at >= ?`,
    )
    .get(agentId, since) as { first_pass: number | null; terminal: number | null };
  const firstPass = isc.first_pass ?? 0;
  const terminal = isc.terminal ?? 0;
  const iscFirstPassRate = terminal === 0 ? 0 : firstPass / terminal;

  // 3. Approvals (M7.5) — approved vs rejected. Schema uses
  //    `status IN ('pending','approved','rejected','expired')` per migration 0007;
  //    completion timestamp is `resolved_at`.
  const approvals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM approvals
       WHERE agent_id = ? AND resolved_at IS NOT NULL`,
    )
    .get(agentId) as { accepted: number | null; rejected: number | null };
  const approvalsAccepted = approvals.accepted ?? 0;
  const approvalsRejected = approvals.rejected ?? 0;

  // 4. Verification failures in window — count goal_criteria failures for
  //    this agent's goals where the failure landed inside the window.
  const verificationFailures = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM goal_criteria gc
         JOIN goals g ON g.id = gc.goal_id
         WHERE g.owner_agent_id = ? AND gc.status = 'failed' AND gc.updated_at >= ?`,
      )
      .get(agentId, since) as { n: number }
  ).n;

  // 5. Demoted in window — any 'demoted' trust_event inside the window.
  const demotedInWindow =
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM trust_events WHERE agent_id = ? AND kind = 'demoted' AND created_at >= ?",
        )
        .get(agentId, since) as { n: number }
    ).n > 0;

  return {
    verifiedOutcomes,
    iscFirstPassRate,
    approvalsAccepted,
    approvalsRejected,
    verificationFailures,
    demotedInWindow,
  };
};
