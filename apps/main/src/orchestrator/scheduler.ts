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
