// Thin interval wrapper around a collector run. Runs once immediately, then every
// intervalMs. Overlap-guarded (skips a tick if the previous run is still going).
// The collector itself is fail-soft, so this never needs its own try/catch beyond
// the overlap guard.
export const startXMetricsPoller = (opts: {
  intervalMs: number;
  run: () => Promise<void>;
}): (() => void) => {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void opts.run().finally(() => {
      running = false;
    });
  };
  tick(); // initial run
  const handle = setInterval(tick, opts.intervalMs);
  return () => clearInterval(handle);
};
