// Picks which agent's adapter to evict to free a concurrency slot. Prefers an
// IDLE agent (no in-flight work — safe to kill; its session is preserved so it
// --resumes on next wake). Never returns `exceptId` (the agent we're spawning).
// Returns null when no idle agent is available to evict.
export const pickIdleEvictionVictim = (
  candidateIds: string[],
  statusOf: (id: string) => string | null,
  exceptId: string,
): string | null => {
  for (const id of candidateIds) {
    if (id === exceptId) continue;
    if (statusOf(id) === "idle") return id;
  }
  return null;
};
