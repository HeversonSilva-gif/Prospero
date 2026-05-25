/**
 * Runs `fn` on a periodic interval, swallowing errors so a transient failure
 * never kills the tick loop. Returns a stopper that cancels the interval.
 * Mirror of startHeartbeat's timer pattern.
 */
export const startSchedulerTick = (fn: () => void, ms: number): (() => void) => {
  const t = setInterval(() => {
    try {
      fn();
    } catch {
      // best-effort — drain must not crash main.
    }
  }, ms);
  return () => {
    clearInterval(t);
  };
};
