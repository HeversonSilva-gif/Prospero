// Direct, issue-board-driven worker re-engagement for the autonomous loop.
//
// The scheduler (drainScheduler) only sees the in-memory router queue, and the
// safety-net reconciler only wakes the CEO. So a worker that is idle but already
// OWNS assigned work on the issue board (todo/doing) — with no queued message to
// spawn it — sits forever unless the CEO happens to re-message it. The CEO is an
// unreliable, expensive single point of failure: it 401s, runs out of budget, or
// (observed 2026-06-05) concludes "I already assigned everything and messaged
// everyone" and goes idle, freezing the whole org with a full board.
//
// This makes the issue board a first-class scheduling input. It decides — purely
// — which idle assignees to wake DIRECTLY so the drain spawns them, independent
// of the CEO. The CEO stays the orchestrator for review/new-assignment decisions;
// this only guarantees already-assigned work doesn't stall behind it.
//
// Eligibility (all must hold): the worker is idle (not `engaged` — no live adapter
// and no queued router work), is NOT blocked on a pending approval (a decision is
// owed — poking it won't help), OWNS >=1 issue in todo/doing, and was not woken
// within the debounce window. The caller debounces per worker so a worker that
// can't make progress is not re-woken every tick (bounds token burn).

export type IdleWorker = {
  id: string;
  /** Has a live adapter OR queued router work — already running / about to run. */
  engaged: boolean;
  /** Blocked on a pending approval — a decision is owed; don't poke it. */
  blockedOnApproval: boolean;
  /** Number of issues assigned to this worker that are in `todo` or `doing`. */
  actionableIssueCount: number;
};

export type IdleAssigneeWakeInput = {
  /** Non-terminated, non-CEO workers with status === 'idle'. */
  workers: IdleWorker[];
  /** Per-worker timestamp of the last direct wake (in-RAM; resets on restart so a
   *  restart promptly re-engages all assigned work — the desired behaviour). */
  lastWakeAt: Map<string, number>;
  now: number;
  debounceMs: number;
};

export const computeIdleAssigneesToWake = (input: IdleAssigneeWakeInput): string[] => {
  const { workers, lastWakeAt, now, debounceMs } = input;
  const out: string[] = [];
  for (const w of workers) {
    if (w.engaged) continue; // already running or about to — leave it
    if (w.blockedOnApproval) continue; // owed a decision — waking won't help
    if (w.actionableIssueCount <= 0) continue; // nothing assigned to do
    const last = lastWakeAt.get(w.id);
    if (last !== undefined && now - last < debounceMs) continue; // debounced
    out.push(w.id);
  }
  return out;
};
