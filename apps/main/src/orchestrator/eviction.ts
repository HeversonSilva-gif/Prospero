export type EvictionCandidate = { status: string | null; updatedAt: number };

// Picks which agent's adapter to evict to free a concurrency slot. Prefers an
// IDLE agent (no in-flight work — cleanest to evict). If none are idle, falls
// back to the least-recently-updated agent (LRU). Never returns exceptId.
// Returns null only when there is no candidate at all.
export const pickEvictionVictim = (
  candidateIds: string[],
  infoOf: (id: string) => EvictionCandidate | null,
  exceptId: string,
): string | null => {
  const others = candidateIds.filter((id) => id !== exceptId);
  const idle = others.find((id) => infoOf(id)?.status === "idle");
  if (idle !== undefined) return idle;
  let lru: string | null = null;
  let lruAt = Infinity;
  for (const id of others) {
    const at = infoOf(id)?.updatedAt ?? 0;
    if (at < lruAt) {
      lruAt = at;
      lru = id;
    }
  }
  return lru;
};
