import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startXMetricsPoller } from "./x-metrics-poller.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startXMetricsPoller", () => {
  it("runs the collector immediately and then every interval, and stop() halts it", async () => {
    const run = vi.fn(() => Promise.resolve());
    const stop = startXMetricsPoller({ intervalMs: 1000, run });
    await vi.advanceTimersByTimeAsync(0); // initial run
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(2); // no more after stop
  });
});
