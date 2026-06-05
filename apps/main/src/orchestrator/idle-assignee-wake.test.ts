import { describe, it, expect } from "vitest";
import { computeIdleAssigneesToWake, type IdleWorker } from "./idle-assignee-wake.js";

const NOW = 10_000_000;
const DEBOUNCE = 600_000; // 10 min

const worker = (over: Partial<IdleWorker> & { id: string }): IdleWorker => ({
  engaged: false,
  blockedOnApproval: false,
  actionableIssueCount: 1,
  ...over,
});

describe("computeIdleAssigneesToWake", () => {
  it("wakes an idle worker that owns actionable work and was never woken", () => {
    const out = computeIdleAssigneesToWake({
      workers: [worker({ id: "w1" })],
      lastWakeAt: new Map(),
      now: NOW,
      debounceMs: DEBOUNCE,
    });
    expect(out).toEqual(["w1"]);
  });

  it("does NOT wake an engaged worker (live adapter or queued message)", () => {
    const out = computeIdleAssigneesToWake({
      workers: [worker({ id: "w1", engaged: true })],
      lastWakeAt: new Map(),
      now: NOW,
      debounceMs: DEBOUNCE,
    });
    expect(out).toEqual([]);
  });

  it("does NOT wake a worker blocked on a pending approval (a decision is owed)", () => {
    const out = computeIdleAssigneesToWake({
      workers: [worker({ id: "w1", blockedOnApproval: true })],
      lastWakeAt: new Map(),
      now: NOW,
      debounceMs: DEBOUNCE,
    });
    expect(out).toEqual([]);
  });

  it("does NOT wake a worker with no actionable (todo/doing) issues", () => {
    const out = computeIdleAssigneesToWake({
      workers: [worker({ id: "w1", actionableIssueCount: 0 })],
      lastWakeAt: new Map(),
      now: NOW,
      debounceMs: DEBOUNCE,
    });
    expect(out).toEqual([]);
  });

  it("does NOT re-wake a worker within the debounce window", () => {
    const out = computeIdleAssigneesToWake({
      workers: [worker({ id: "w1" })],
      lastWakeAt: new Map([["w1", NOW - DEBOUNCE + 1]]),
      now: NOW,
      debounceMs: DEBOUNCE,
    });
    expect(out).toEqual([]);
  });

  it("re-wakes exactly at the debounce boundary", () => {
    const out = computeIdleAssigneesToWake({
      workers: [worker({ id: "w1" })],
      lastWakeAt: new Map([["w1", NOW - DEBOUNCE]]),
      now: NOW,
      debounceMs: DEBOUNCE,
    });
    expect(out).toEqual(["w1"]);
  });

  it("filters a mixed roster correctly (the screenshot scenario)", () => {
    const out = computeIdleAssigneesToWake({
      workers: [
        worker({ id: "idle-with-work" }), // wake
        worker({ id: "engaged", engaged: true }), // running → skip
        worker({ id: "blocked", blockedOnApproval: true }), // approval → skip
        worker({ id: "nothing", actionableIssueCount: 0 }), // no work → skip
        worker({ id: "debounced" }), // woken recently → skip
      ],
      lastWakeAt: new Map([["debounced", NOW - 1]]),
      now: NOW,
      debounceMs: DEBOUNCE,
    });
    expect(out).toEqual(["idle-with-work"]);
  });

  it("returns empty when there are no workers", () => {
    expect(
      computeIdleAssigneesToWake({
        workers: [],
        lastWakeAt: new Map(),
        now: NOW,
        debounceMs: DEBOUNCE,
      }),
    ).toEqual([]);
  });
});
