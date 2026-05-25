// True when a finished turn re-read more cached context than the threshold —
// the signal that the session transcript has grown big enough to be worth
// distilling and restarting. threshold <= 0 disables compaction entirely.
export const shouldCompact = (usage: { cacheRead: number }, threshold: number): boolean =>
  threshold > 0 && usage.cacheRead > threshold;
