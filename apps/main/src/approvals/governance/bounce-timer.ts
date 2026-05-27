// Mirror of escalation-timer.ts: same shape, different intent.
// arm() schedules a callback after timeoutMs; cancel() drops it.

export interface BounceTimers {
  arm(approvalId: string): void;
  cancel(approvalId: string): void;
  clearAll(): void;
}

export const createBounceTimers = (opts: {
  timeoutMs: number;
  onBounce: (approvalId: string) => void;
}): BounceTimers => {
  const timers = new Map<string, NodeJS.Timeout>();
  return {
    arm(approvalId) {
      const existing = timers.get(approvalId);
      if (existing !== undefined) clearTimeout(existing);
      const handle = setTimeout(() => {
        timers.delete(approvalId);
        opts.onBounce(approvalId);
      }, opts.timeoutMs);
      timers.set(approvalId, handle);
    },
    cancel(approvalId) {
      const h = timers.get(approvalId);
      if (h !== undefined) {
        clearTimeout(h);
        timers.delete(approvalId);
      }
    },
    clearAll() {
      for (const h of timers.values()) clearTimeout(h);
      timers.clear();
    },
  };
};
