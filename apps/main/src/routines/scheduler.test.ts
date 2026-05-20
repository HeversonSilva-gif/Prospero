import { describe, it, expect, vi } from "vitest";
import type { Routine } from "@prospero/shared";
import { createRoutineScheduler } from "./scheduler.js";

const baseRoutine: Routine = {
  id: "r1",
  companyId: "c1",
  name: "Standup",
  enabled: true,
  triggerType: "schedule",
  scheduleSpec: { freq: "daily", atMinute: 540 },
  nextFireAt: 100,
  eventSpec: null,
  targetAgentId: "a1",
  instruction: "Run standup",
  lastFiredAt: null,
  createdAt: 0,
  updatedAt: 0,
};

describe("createRoutineScheduler", () => {
  it("tick fires a due routine with reason='scheduled' when next_fire_at is recent", () => {
    const fire = vi.fn();
    const advanceNextFire = vi.fn();
    const tickMs = 30_000;
    const s = createRoutineScheduler({
      now: () => 110_000,
      listDueSchedule: () => [{ ...baseRoutine, nextFireAt: 100_000 }],
      fire,
      advanceNextFire,
      tickMs,
    });
    s.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0]![1]).toBe("scheduled");
    expect(advanceNextFire).toHaveBeenCalledTimes(1);
  });

  it("tick fires a long-overdue routine with reason='catchup'", () => {
    const fire = vi.fn();
    const advanceNextFire = vi.fn();
    const tickMs = 30_000;
    const s = createRoutineScheduler({
      now: () => 10_000_000,
      // next_fire_at is way more than one tick window in the past
      listDueSchedule: () => [{ ...baseRoutine, nextFireAt: 1_000 }],
      fire,
      advanceNextFire,
      tickMs,
    });
    s.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0]![1]).toBe("catchup");
  });

  it("tick does nothing when listDueSchedule returns empty", () => {
    const fire = vi.fn();
    const advanceNextFire = vi.fn();
    const s = createRoutineScheduler({
      now: () => 0,
      listDueSchedule: () => [],
      fire,
      advanceNextFire,
      tickMs: 30_000,
    });
    s.tick();
    expect(fire).not.toHaveBeenCalled();
    expect(advanceNextFire).not.toHaveBeenCalled();
  });

  it("start runs an immediate tick then schedules the interval", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const advanceNextFire = vi.fn();
    const s = createRoutineScheduler({
      now: () => 1_000_000,
      listDueSchedule: () => [{ ...baseRoutine, nextFireAt: 100 }],
      fire,
      advanceNextFire,
      tickMs: 30_000,
    });
    s.start();
    // First tick happens synchronously on start.
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(fire).toHaveBeenCalledTimes(2);
    s.stop();
    vi.useRealTimers();
  });

  it("stop is a no-op when never started", () => {
    const s = createRoutineScheduler({
      now: () => 0,
      listDueSchedule: () => [],
      fire: vi.fn(),
      advanceNextFire: vi.fn(),
      tickMs: 30_000,
    });
    expect(() => s.stop()).not.toThrow();
  });
});
