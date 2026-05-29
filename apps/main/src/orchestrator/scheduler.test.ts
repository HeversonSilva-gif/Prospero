import { describe, it, expect } from "vitest";
import {
  computeScheduleActions,
  computeLaneSchedule,
  type RunningAgent,
  type LaneAgent,
} from "./scheduler.js";

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

  it("parked (approval-blocked) running agent yields its slot to a waiter", () => {
    // 4 running, all hasWork, but r4 is parked (blocked on a user approval —
    // making no progress). 1 waiter. No truly-idle agent. Pre-fix this starved
    // the waiter forever; now the parked agent is evicted to free its slot.
    const result = computeScheduleActions(
      [
        { id: "r1", hasWork: true },
        { id: "r2", hasWork: true },
        { id: "r3", hasWork: true },
        { id: "r4", hasWork: true, parked: true },
      ],
      ["w1"],
      4,
    );
    expect(result.toSpawn).toEqual(["w1"]);
    expect(result.toEvict).toEqual(["r4"]);
  });

  it("evicts truly-idle agents before parked ones", () => {
    // r3 idle, r4 parked, 2 waiters → idle evicted first, then parked.
    const result = computeScheduleActions(
      [
        { id: "r1", hasWork: true },
        { id: "r2", hasWork: true },
        { id: "r3", hasWork: false },
        { id: "r4", hasWork: true, parked: true },
      ],
      ["w1", "w2"],
      4,
    );
    expect(result.toSpawn).toEqual(["w1", "w2"]);
    expect(result.toEvict).toEqual(["r3", "r4"]);
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

const lane = (...agents: Array<[string, boolean, boolean]>): LaneAgent[] =>
  agents.map(([id, isCeo, hasWork]) => ({ id, isCeo, hasWork }));

describe("computeLaneSchedule (CEO management lane)", () => {
  it("workers fill at most max-1; the last slot stays reserved", () => {
    // 0 running, 4 workers waiting, max 4 → only 3 workers spawn (lane reserved)
    const r = computeLaneSchedule(
      [],
      lane(["w1", false, true], ["w2", false, true], ["w3", false, true], ["w4", false, true]),
      4,
    );
    expect(r.toSpawn).toEqual(["w1", "w2", "w3"]);
    expect(r.toEvict).toEqual([]);
  });

  it("CEO claims the reserved slot even when 3 workers already run (the deadlock fix)", () => {
    // 3 workers blocked (hasWork), CEO waiting → CEO spawns into slot 4
    const r = computeLaneSchedule(
      lane(["w1", false, true], ["w2", false, true], ["w3", false, true]),
      lane(["ceo", true, true]),
      4,
    );
    expect(r.toSpawn).toEqual(["ceo"]);
    expect(r.toEvict).toEqual([]);
  });

  it("CEO is prioritized ahead of waiting workers for the free slot", () => {
    // 3 workers running, both a CEO and a worker waiting, 1 effective slot →
    // the CEO takes it (reserved lane), the worker keeps waiting
    const r = computeLaneSchedule(
      lane(["w1", false, true], ["w2", false, true], ["w3", false, true]),
      lane(["w4", false, true], ["ceo", true, true]),
      4,
    );
    expect(r.toSpawn).toEqual(["ceo"]);
  });

  it("CEO + workers spawn together without exceeding max", () => {
    const r = computeLaneSchedule(
      [],
      lane(["ceo", true, true], ["w1", false, true], ["w2", false, true], ["w3", false, true]),
      4,
    );
    // ceo + 3 workers = 4
    expect(r.toSpawn).toEqual(["ceo", "w1", "w2", "w3"]);
    expect(r.toSpawn).toHaveLength(4);
  });

  it("two CEOs (multi-company) + workers never exceed max total", () => {
    // 2 CEOs spawn (mgmt) → workers limited so total stays ≤ 4
    const r = computeLaneSchedule(
      [],
      lane(
        ["ceoA", true, true],
        ["ceoB", true, true],
        ["w1", false, true],
        ["w2", false, true],
        ["w3", false, true],
      ),
      4,
    );
    expect(r.toSpawn).toEqual(["ceoA", "ceoB", "w1", "w2"]);
    expect(r.toSpawn).toHaveLength(4);
  });

  it("CEO cannot spawn when the hard total is already full", () => {
    // 3 workers + 1 running CEO = 4 live; a second CEO waits → no room
    const r = computeLaneSchedule(
      lane(["w1", false, true], ["w2", false, true], ["w3", false, true], ["ceoA", true, true]),
      lane(["ceoB", true, true]),
      4,
    );
    expect(r.toSpawn).toEqual([]);
  });

  it("a parked (approval-blocked) worker yields its slot to a waiting worker", () => {
    // 3 workers running (lane reserves the 4th), w3 parked on an approval, a
    // fresh worker w4 waiting → w3 is evicted so w4 can run.
    const r = computeLaneSchedule(
      [
        { id: "w1", isCeo: false, hasWork: true },
        { id: "w2", isCeo: false, hasWork: true },
        { id: "w3", isCeo: false, hasWork: true, parked: true },
      ],
      lane(["w4", false, true]),
      4,
    );
    expect(r.toSpawn).toEqual(["w4"]);
    expect(r.toEvict).toEqual(["w3"]);
  });

  it("no CEO involved → behaves like a max-1 worker pool", () => {
    // 2 workers running with work, 3 waiting, max 4 → 1 free worker slot (lane reserved)
    const r = computeLaneSchedule(
      lane(["w1", false, true], ["w2", false, true]),
      lane(["w3", false, true], ["w4", false, true], ["w5", false, true]),
      4,
    );
    expect(r.toSpawn).toEqual(["w3"]);
  });
});
