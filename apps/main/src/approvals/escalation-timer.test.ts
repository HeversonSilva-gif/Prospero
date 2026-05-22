import { describe, it, expect, vi } from "vitest";
import { createEscalationTimers } from "./escalation-timer.js";

describe("escalation timers", () => {
  it("fires the escalate callback after the timeout when still pending", () => {
    vi.useFakeTimers();
    const onEscalate = vi.fn();
    const t = createEscalationTimers({ timeoutMs: 600_000, onEscalate });
    t.arm("apv1");
    vi.advanceTimersByTime(600_000);
    expect(onEscalate).toHaveBeenCalledWith("apv1");
    vi.useRealTimers();
  });

  it("cancel prevents the escalate callback", () => {
    vi.useFakeTimers();
    const onEscalate = vi.fn();
    const t = createEscalationTimers({ timeoutMs: 600_000, onEscalate });
    t.arm("apv1");
    t.cancel("apv1");
    vi.advanceTimersByTime(600_000);
    expect(onEscalate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
