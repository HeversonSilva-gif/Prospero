import { describe, it, expect } from "vitest";
import { computeScheduleActions, type RunningAgent } from "./scheduler.js";

const running = (...agents: Array<[string, boolean]>): RunningAgent[] =>
  agents.map(([id, hasWork]) => ({ id, hasWork }));

describe("computeScheduleActions", () => {
  it("spawns into free slots when there is room, no eviction", () => {
    // 2 running, max 4, 2 waiting → 2 free slots → spawn both, evict none
    const result = computeScheduleActions(running(["r1", true], ["r2", true]), ["w1", "w2"], 4);
    expect(result.toSpawn).toEqual(["w1", "w2"]);
    expect(result.toEvict).toEqual([]);
  });

  it("only spawns as many as free slots allow without eviction", () => {
    // 3 running, max 4, 3 waiting → 1 free slot → spawn 1, no eviction
    const result = computeScheduleActions(
      running(["r1", true], ["r2", true], ["r3", true]),
      ["w1", "w2", "w3"],
      4,
    );
    expect(result.toSpawn).toEqual(["w1"]);
    expect(result.toEvict).toEqual([]);
  });

  it("full + waiters + idle running → evict idle to make room, spawn them", () => {
    // 4 running (r3 + r4 are idle), max 4, 2 waiting
    // → 0 free slots, 2 idle, 2 waiting → evict r3+r4, spawn w1+w2
    const result = computeScheduleActions(
      running(["r1", true], ["r2", true], ["r3", false], ["r4", false]),
      ["w1", "w2"],
      4,
    );
    expect(result.toSpawn).toEqual(["w1", "w2"]);
    expect(result.toEvict).toEqual(["r3", "r4"]);
  });

  it("full + more waiters than idle → evict only idle count, spawn that many", () => {
    // 4 running (r4 idle), max 4, 3 waiting
    // → evict 1 (r4), spawn 1 (w1) — only 1 slot freed
    const result = computeScheduleActions(
      running(["r1", true], ["r2", true], ["r3", true], ["r4", false]),
      ["w1", "w2", "w3"],
      4,
    );
    expect(result.toSpawn).toEqual(["w1"]);
    expect(result.toEvict).toEqual(["r4"]);
  });

  it("full + waiters + NO idle running → spawn nothing, evict nothing", () => {
    // All 4 running have work — cannot evict any
    const result = computeScheduleActions(
      running(["r1", true], ["r2", true], ["r3", true], ["r4", true]),
      ["w1", "w2"],
      4,
    );
    expect(result.toSpawn).toEqual([]);
    expect(result.toEvict).toEqual([]);
  });

  it("waiting is empty → no actions regardless of running state", () => {
    const result = computeScheduleActions(running(["r1", true], ["r2", false]), [], 4);
    expect(result.toSpawn).toEqual([]);
    expect(result.toEvict).toEqual([]);
  });

  it("no running agents + waiters → spawn up to max", () => {
    const result = computeScheduleActions([], ["w1", "w2", "w3", "w4", "w5"], 4);
    expect(result.toSpawn).toEqual(["w1", "w2", "w3", "w4"]);
    expect(result.toEvict).toEqual([]);
  });

  it("respects max=1 boundary", () => {
    // 1 idle running, 2 waiting, max=1
    // → 0 free slots, 1 idle, 2 waiting → evict 1, spawn 1
    const result = computeScheduleActions(running(["r1", false]), ["w1", "w2"], 1);
    expect(result.toSpawn).toEqual(["w1"]);
    expect(result.toEvict).toEqual(["r1"]);
  });

  it("running > max (over-provisioned) → no free slots, behaves safely", () => {
    // 5 running but max=4 — free = max(0, 4-5) = 0
    const result = computeScheduleActions(
      running(["r1", true], ["r2", true], ["r3", true], ["r4", true], ["r5", false]),
      ["w1"],
      4,
    );
    // 0 free slots, 1 idle (r5), 1 waiter → evict r5, spawn w1
    expect(result.toSpawn).toEqual(["w1"]);
    expect(result.toEvict).toEqual(["r5"]);
  });
});
