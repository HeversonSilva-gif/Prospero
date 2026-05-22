export interface EscalationTimers {
  arm(approvalId: string): void;
  cancel(approvalId: string): void;
  clearAll(): void;
}

export const createEscalationTimers = (opts: {
  timeoutMs: number;
  onEscalate: (approvalId: string) => void;
}): EscalationTimers => {
  const timers = new Map<string, NodeJS.Timeout>();
  return {
    arm(approvalId) {
      const existing = timers.get(approvalId);
      if (existing !== undefined) clearTimeout(existing);
      const handle = setTimeout(() => {
        timers.delete(approvalId);
        opts.onEscalate(approvalId);
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
