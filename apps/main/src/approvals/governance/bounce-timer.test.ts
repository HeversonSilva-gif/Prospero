import { describe, it, expect, vi } from "vitest";
import { createBounceTimers } from "./bounce-timer.js";

describe("bounce timers", () => {
  it("fires the bounce callback after the timeout when armed", () => {
    vi.useFakeTimers();
    const onBounce = vi.fn();
    const t = createBounceTimers({ timeoutMs: 4 * 60 * 60_000, onBounce });
    t.arm("apv1");
    vi.advanceTimersByTime(4 * 60 * 60_000);
    expect(onBounce).toHaveBeenCalledWith("apv1");
    vi.useRealTimers();
  });

  it("cancel prevents the bounce callback", () => {
    vi.useFakeTimers();
    const onBounce = vi.fn();
    const t = createBounceTimers({ timeoutMs: 1_000, onBounce });
    t.arm("apv1");
    t.cancel("apv1");
    vi.advanceTimersByTime(2_000);
    expect(onBounce).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("arming the same id twice replaces the prior timer", () => {
    vi.useFakeTimers();
    const onBounce = vi.fn();
    const t = createBounceTimers({ timeoutMs: 10_000, onBounce });
    t.arm("apv1");
    vi.advanceTimersByTime(5_000);
    t.arm("apv1");
    vi.advanceTimersByTime(5_000);
    expect(onBounce).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(onBounce).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancel is idempotent", () => {
    vi.useFakeTimers();
    const onBounce = vi.fn();
    const t = createBounceTimers({ timeoutMs: 1_000, onBounce });
    t.cancel("apv-nonexistent");
    t.arm("apv1");
    t.cancel("apv1");
    t.cancel("apv1");
    vi.advanceTimersByTime(2_000);
    expect(onBounce).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("clearAll cancels every pending timer", () => {
    vi.useFakeTimers();
    const onBounce = vi.fn();
    const t = createBounceTimers({ timeoutMs: 1_000, onBounce });
    t.arm("a");
    t.arm("b");
    t.arm("c");
    t.clearAll();
    vi.advanceTimersByTime(2_000);
    expect(onBounce).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
