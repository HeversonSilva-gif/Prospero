// Time-window rate limiter. The MCP server is one process per agent and cannot
// observe turn boundaries, so M11 write caps ("3 memory / 5 skill per turn")
// are approximated by a rolling time window per key.
export type RateLimiter = {
  // Records one consumption and returns whether it was within the cap.
  tryConsume(key: string): boolean;
};

export const createRateLimiter = (maxInWindow: number, windowMs: number): RateLimiter => {
  const hits = new Map<string, number[]>();
  return {
    tryConsume(key) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= maxInWindow) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
};
