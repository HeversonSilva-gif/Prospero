// Per-agent trailing-edge debouncer for current-action-changed broadcasts.
// A turn can fire many tool_use blocks in <50ms; we coalesce to the most
// recent value and emit once after the window.

export type CurrentActionEmit = (agentId: string, action: string | null) => void;

export interface CurrentActionDebouncer {
  schedule(agentId: string, action: string | null): void;
  flush(agentId: string): void;
  flushAll(): void;
  cancel(agentId: string): void;
}

type Pending = { action: string | null; timer: NodeJS.Timeout };

export const createCurrentActionDebouncer = (
  emit: CurrentActionEmit,
  windowMs: number,
): CurrentActionDebouncer => {
  const pending = new Map<string, Pending>();

  const fire = (agentId: string): void => {
    const p = pending.get(agentId);
    if (p === undefined) return;
    pending.delete(agentId);
    emit(agentId, p.action);
  };

  return {
    schedule(agentId, action) {
      const existing = pending.get(agentId);
      if (existing !== undefined) clearTimeout(existing.timer);
      const timer = setTimeout(() => fire(agentId), windowMs);
      pending.set(agentId, { action, timer });
    },
    flush(agentId) {
      const p = pending.get(agentId);
      if (p === undefined) return;
      clearTimeout(p.timer);
      fire(agentId);
    },
    flushAll() {
      for (const id of [...pending.keys()]) {
        const p = pending.get(id);
        if (p !== undefined) clearTimeout(p.timer);
        fire(id);
      }
    },
    cancel(agentId) {
      const p = pending.get(agentId);
      if (p === undefined) return;
      clearTimeout(p.timer);
      pending.delete(agentId);
    },
  };
};
