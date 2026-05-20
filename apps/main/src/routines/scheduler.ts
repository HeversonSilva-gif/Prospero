import type { FireReason, Routine } from "@prospero/shared";

// M15 PR-A — RoutineScheduler. In-process tick loop (~30s). The tick is
// idempotent — re-firing the same routine within the same tick window
// is prevented by `advanceNextFire` pushing `next_fire_at` strictly
// past `now` before the next select.

export interface RoutineScheduler {
  start(): void;
  stop(): void;
  tick(): void;
}

export interface RoutineSchedulerDeps {
  now: () => number;
  listDueSchedule: (now: number) => Routine[];
  fire: (routine: Routine, reason: FireReason) => void;
  advanceNextFire: (routine: Routine, now: number) => void;
  tickMs: number;
}

export const createRoutineScheduler = (deps: RoutineSchedulerDeps): RoutineScheduler => {
  let handle: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    const t = deps.now();
    for (const r of deps.listDueSchedule(t)) {
      const overdue = r.nextFireAt !== null && r.nextFireAt < t - deps.tickMs;
      const reason: FireReason = overdue ? "catchup" : "scheduled";
      deps.fire(r, reason);
      deps.advanceNextFire(r, t);
    }
  };

  return {
    start() {
      tick();
      handle = setInterval(tick, deps.tickMs);
    },
    stop() {
      if (handle !== null) clearInterval(handle);
      handle = null;
    },
    tick,
  };
};
