import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCoalescer, type Coalescer } from "./coalescer.js";

describe("CEO approval coalescer", () => {
  let onFlush: ReturnType<typeof vi.fn>;
  let c: Coalescer;

  beforeEach(() => {
    vi.useFakeTimers();
    onFlush = vi.fn();
    c = createCoalescer({ windowMs: 60_000, onFlush });
  });

  afterEach(() => {
    c.clearAll();
    vi.useRealTimers();
  });

  it("first non-destructive approval arms the timer; flush fires at 60s with that id", () => {
    c.enqueue({ companyId: "c1", approvalId: "apv_1", destructive: false });
    vi.advanceTimersByTime(59_000);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ companyId: "c1", approvalIds: ["apv_1"] });
  });

  it("subsequent non-destructive approvals join the batch without resetting the timer", () => {
    c.enqueue({ companyId: "c1", approvalId: "apv_1", destructive: false });
    vi.advanceTimersByTime(30_000);
    c.enqueue({ companyId: "c1", approvalId: "apv_2", destructive: false });
    vi.advanceTimersByTime(30_000);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ companyId: "c1", approvalIds: ["apv_1", "apv_2"] });
  });

  it("a destructive arrival collapses the window — flush fires immediately with the whole batch including the destructive", () => {
    c.enqueue({ companyId: "c1", approvalId: "apv_1", destructive: false });
    c.enqueue({ companyId: "c1", approvalId: "apv_2", destructive: false });
    c.enqueue({ companyId: "c1", approvalId: "apv_3", destructive: true });
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({
      companyId: "c1",
      approvalIds: ["apv_1", "apv_2", "apv_3"],
    });
    // After the destructive flush, the queue is empty and the timer is canceled.
    vi.advanceTimersByTime(60_000);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("a destructive arrival with no queued items still triggers an immediate single-item flush", () => {
    c.enqueue({ companyId: "c1", approvalId: "apv_d", destructive: true });
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ companyId: "c1", approvalIds: ["apv_d"] });
  });

  it("isolates queues per company — flushing c1 does not affect c2", () => {
    c.enqueue({ companyId: "c1", approvalId: "apv_a", destructive: false });
    c.enqueue({ companyId: "c2", approvalId: "apv_b", destructive: false });
    c.enqueue({ companyId: "c1", approvalId: "apv_a2", destructive: true });
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({
      companyId: "c1",
      approvalIds: ["apv_a", "apv_a2"],
    });
    // c2 still ticking
    vi.advanceTimersByTime(60_000);
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith({ companyId: "c2", approvalIds: ["apv_b"] });
  });

  it("clearAll cancels every pending timer and drops every queue", () => {
    c.enqueue({ companyId: "c1", approvalId: "apv_1", destructive: false });
    c.enqueue({ companyId: "c2", approvalId: "apv_2", destructive: false });
    c.clearAll();
    vi.advanceTimersByTime(60_000);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("enqueueing the same approvalId twice deduplicates within a batch", () => {
    c.enqueue({ companyId: "c1", approvalId: "apv_x", destructive: false });
    c.enqueue({ companyId: "c1", approvalId: "apv_x", destructive: false });
    vi.advanceTimersByTime(60_000);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ companyId: "c1", approvalIds: ["apv_x"] });
  });
});
