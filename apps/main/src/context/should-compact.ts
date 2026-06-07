// True when a finished turn's prompt prefix (read from OR freshly written to the
// cache) exceeded the threshold — the signal the session has grown big enough to
// distill + restart. Summing cacheRead + cacheCreation (not cacheRead alone) is
// what catches a COLD turn: right after a restart the whole prefix is billed as
// cache_creation and cacheRead is ~0, so the old read-only check skipped
// compaction on exactly the most expensive (cold-write) turn — and the large
// session then persisted into the next cold boot (the "open the app and it costs
// $$$" amplifier on the API). threshold <= 0 disables compaction entirely.
export const shouldCompact = (
  usage: { cacheRead: number; cacheCreation: number },
  threshold: number,
): boolean => threshold > 0 && usage.cacheRead + usage.cacheCreation > threshold;
