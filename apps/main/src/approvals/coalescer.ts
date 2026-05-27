// CEO approval coalescer (V2 piece #5). Holds a per-company queue and a
// single 60s setTimeout. Pure module — no DB, no Electron, no IPC; the
// caller wires it to wakeCeoForApproval via the onFlush callback.
//
// Behavior:
//   enqueue(non-destructive) → push to queue; arm timer if not armed
//   enqueue(destructive)     → push to queue; cancel timer; flush now
//   timer fires              → pop the whole queue; call onFlush(batch)
//
// Spec rationale: batching cuts CEO wake count by 5-8× under the typical
// 80-approvals-per-day burst pattern; a destructive request collapses
// the window so urgent decisions are never delayed by the batching.

export type EnqueueInput = {
  companyId: string;
  approvalId: string;
  destructive: boolean;
};

export type FlushPayload = {
  companyId: string;
  approvalIds: string[];
};

export type Coalescer = {
  enqueue(input: EnqueueInput): void;
  clearAll(): void;
};

export const createCoalescer = (opts: {
  windowMs: number;
  onFlush: (payload: FlushPayload) => void;
}): Coalescer => {
  const queues = new Map<string, string[]>();
  const timers = new Map<string, NodeJS.Timeout>();

  const flushNow = (companyId: string): void => {
    const ids = queues.get(companyId);
    if (ids === undefined || ids.length === 0) return;
    const timer = timers.get(companyId);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(companyId);
    }
    queues.delete(companyId);
    opts.onFlush({ companyId, approvalIds: ids });
  };

  return {
    enqueue(input) {
      const existing = queues.get(input.companyId) ?? [];
      if (!existing.includes(input.approvalId)) {
        existing.push(input.approvalId);
      }
      queues.set(input.companyId, existing);

      if (input.destructive) {
        flushNow(input.companyId);
        return;
      }

      if (!timers.has(input.companyId)) {
        const t = setTimeout(() => flushNow(input.companyId), opts.windowMs);
        timers.set(input.companyId, t);
      }
    },
    clearAll() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      queues.clear();
    },
  };
};
