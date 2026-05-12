import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createCurrentActionDebouncer } from "../src/orchestrator/event-throttle.js";

describe("createCurrentActionDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits the last value after the debounce window", () => {
    const emit = vi.fn();
    const d = createCurrentActionDebouncer(emit, 200);
    d.schedule("agent_1", "Reading a.ts");
    d.schedule("agent_1", "Reading b.ts");
    d.schedule("agent_1", "Reading c.ts");
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("agent_1", "Reading c.ts");
  });

  it("independent debounce per agent id", () => {
    const emit = vi.fn();
    const d = createCurrentActionDebouncer(emit, 200);
    d.schedule("agent_1", "X");
    d.schedule("agent_2", "Y");
    vi.advanceTimersByTime(200);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith("agent_1", "X");
    expect(emit).toHaveBeenCalledWith("agent_2", "Y");
  });

  it("flush() emits pending values immediately and clears timers", () => {
    const emit = vi.fn();
    const d = createCurrentActionDebouncer(emit, 200);
    d.schedule("agent_1", "Reading a.ts");
    d.flush("agent_1");
    expect(emit).toHaveBeenCalledWith("agent_1", "Reading a.ts");
    vi.advanceTimersByTime(500);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("flushAll() emits all pending values", () => {
    const emit = vi.fn();
    const d = createCurrentActionDebouncer(emit, 200);
    d.schedule("agent_1", "A");
    d.schedule("agent_2", "B");
    d.flushAll();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("null action emits null (used to clear at turn-complete)", () => {
    const emit = vi.fn();
    const d = createCurrentActionDebouncer(emit, 200);
    d.schedule("agent_1", "Reading a.ts");
    d.schedule("agent_1", null);
    vi.advanceTimersByTime(200);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("agent_1", null);
  });

  it("cancel(agentId) drops pending emit without firing", () => {
    const emit = vi.fn();
    const d = createCurrentActionDebouncer(emit, 200);
    d.schedule("agent_1", "Reading a.ts");
    d.cancel("agent_1");
    vi.advanceTimersByTime(500);
    expect(emit).not.toHaveBeenCalled();
  });
});
