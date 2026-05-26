// Decides which waiting agents to spawn and which idle running agents to evict
// to keep up to `max` agents (with pending work) running. Pure + deterministic.
export type RunningAgent = { id: string; hasWork: boolean };

export const computeScheduleActions = (
  running: RunningAgent[],
  waiting: string[], // agent ids with pending work but no live adapter (FIFO)
  max: number,
): { toSpawn: string[]; toEvict: string[] } => {
  const free = Math.max(0, max - running.length);
  const toSpawn = waiting.slice(0, free);
  const rest = waiting.slice(free);
  if (rest.length === 0) return { toSpawn, toEvict: [] };
  // No free slots but waiters remain: evict idle (no-work) running agents to
  // make room, one per remaining waiter, up to the number of idle agents.
  const idle = running.filter((r) => !r.hasWork).map((r) => r.id);
  const evictCount = Math.min(idle.length, rest.length);
  return {
    toSpawn: [...toSpawn, ...rest.slice(0, evictCount)],
    toEvict: idle.slice(0, evictCount),
  };
};

// Lane-aware scheduling. Reserves one "management lane" for the CEO so a CEO
// with pending approvals can always claim a slot to decide them. Without this,
// approval-blocked workers can hold every slot the CEO needs to unblock them —
// a priority-inversion deadlock. Workers therefore fill at most `max - 1` slots;
// the CEO uses the remaining capacity (total never exceeds `max`). Pure +
// deterministic; delegates the worker pool to computeScheduleActions.
export type LaneAgent = { id: string; isCeo: boolean; hasWork: boolean };

export const computeLaneSchedule = (
  running: LaneAgent[],
  waiting: LaneAgent[], // pending work but no live adapter (FIFO)
  max: number,
): { toSpawn: string[]; toEvict: string[] } => {
  // CEO lane: waiting CEOs spawn up to the hard total cap (FIFO among CEOs).
  const ceoToSpawn: string[] = [];
  let total = running.length;
  for (const w of waiting) {
    if (!w.isCeo) continue;
    if (total >= max) break;
    ceoToSpawn.push(w.id);
    total++;
  }
  // Worker pool budget: at most max-1 (reserve the lane) AND never let the
  // CEOs + workers total exceed max (matters when >1 CEO runs, multi-company).
  const ceosBusy = running.filter((r) => r.isCeo).length + ceoToSpawn.length;
  const workerBudget = Math.max(0, Math.min(max - 1, max - ceosBusy));
  const runningWorkers = running
    .filter((r) => !r.isCeo)
    .map((r) => ({ id: r.id, hasWork: r.hasWork }));
  const waitingWorkers = waiting.filter((w) => !w.isCeo).map((w) => w.id);
  const { toSpawn: workerSpawn, toEvict } = computeScheduleActions(
    runningWorkers,
    waitingWorkers,
    workerBudget,
  );
  return { toSpawn: [...ceoToSpawn, ...workerSpawn], toEvict };
};
