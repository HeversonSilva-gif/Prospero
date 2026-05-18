import { describe, it, expect } from "vitest";
import {
  createNudgeTracker,
  NUDGE_SKILL_HINT,
  NUDGE_CONSOLIDATION_HINT,
  TURN_THRESHOLD,
  TOOL_THRESHOLD,
} from "./nudge.js";

const quiet = { toolUseCount: 0, memoryNearFull: false };

describe("createNudgeTracker", () => {
  it("returns null before the turn threshold is reached", () => {
    const t = createNudgeTracker();
    let last: string | null = "x";
    for (let i = 0; i < TURN_THRESHOLD - 1; i += 1) last = t.recordTurn("a1", quiet);
    expect(last).toBeNull();
  });

  it("returns the skill hint exactly on the turn threshold, then resets", () => {
    const t = createNudgeTracker();
    let last: string | null = null;
    for (let i = 0; i < TURN_THRESHOLD; i += 1) last = t.recordTurn("a1", quiet);
    expect(last).toBe(NUDGE_SKILL_HINT);
    // counter reset — the very next turn does not immediately re-fire
    expect(t.recordTurn("a1", quiet)).toBeNull();
  });

  it("returns the skill hint when cumulative tool calls cross the threshold", () => {
    const t = createNudgeTracker();
    expect(t.recordTurn("a1", { toolUseCount: TOOL_THRESHOLD, memoryNearFull: false })).toBe(
      NUDGE_SKILL_HINT,
    );
  });

  it("returns the consolidation hint once when memory is near full", () => {
    const t = createNudgeTracker();
    expect(t.recordTurn("a1", { toolUseCount: 0, memoryNearFull: true })).toBe(
      NUDGE_CONSOLIDATION_HINT,
    );
    // does not repeat on the next near-full turn
    expect(t.recordTurn("a1", { toolUseCount: 0, memoryNearFull: true })).toBeNull();
  });

  it("tracks each agent independently", () => {
    const t = createNudgeTracker();
    for (let i = 0; i < TURN_THRESHOLD - 1; i += 1) t.recordTurn("a1", quiet);
    expect(t.recordTurn("a2", quiet)).toBeNull(); // a2 has its own counter
  });

  it("clear() forgets an agent's counters", () => {
    const t = createNudgeTracker();
    for (let i = 0; i < TURN_THRESHOLD - 1; i += 1) t.recordTurn("a1", quiet);
    t.clear("a1");
    expect(t.recordTurn("a1", quiet)).toBeNull(); // counting restarts from zero
  });
});
