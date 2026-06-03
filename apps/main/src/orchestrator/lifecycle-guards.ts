// Small, pure lifecycle guards for the orchestrator's spawn/turn machinery.
// Extracted so the subtle invariants can be unit-tested without standing up the
// whole orchestrator-handlers closure. Audit 2026-06-03 Facet 1 (I4, C2).

/**
 * Whether a lifecycle event (process exit, turn-complete) may overwrite the
 * agent's status back to idle/error/thinking. A `paused` (budget) or
 * `terminated` agent must KEEP its status — a process exit must not resurrect a
 * paused agent to idle (the pause would be lost and it would respawn and keep
 * spending) nor revive a terminated one. `terminatedAt` is the authoritative
 * kill marker even when `status` was reset to idle (zombie row). Mirrors the
 * turn-complete guard in orchestrator-handlers. Returns `true` when the row is
 * gone (no status to protect).
 */
export const mayOverwriteStatusOnLifecycleEvent = (
  live: { status: string; terminatedAt: number | null } | null,
): boolean =>
  live === null ||
  (live.status !== "paused" && live.status !== "terminated" && live.terminatedAt === null);

/**
 * First-unanswered-write-wins for the pending-turn map. The pending turn is the
 * user message a respawn replays after a crash/auth-recovery. During a 401 the
 * adapter can stay alive through the recovery debounce, so a SECOND message
 * would otherwise clobber the first still-unanswered turn — which then never
 * gets replayed. Keep the oldest pending entry until it is cleared on
 * turn-complete. Audit 2026-06-03 Facet 1 C2.
 */
export const rememberPendingTurn = <T>(map: Map<string, T>, agentId: string, turn: T): void => {
  if (!map.has(agentId)) map.set(agentId, turn);
};
