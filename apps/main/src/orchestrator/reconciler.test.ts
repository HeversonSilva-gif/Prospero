import { describe, expect, it } from "vitest";
import { computeReconcileDecision, type ReconcileInput } from "./reconciler.js";

const base: ReconcileInput = {
  ceoId: "ceo-1",
  ceoEngaged: false,
  anyWorkerEngaged: false,
  counts: { todo: 0, doing: 0, review: 0 },
  verificationFailedGoals: [],
  ceoLastWakeAt: null,
  now: 10_000_000,
  debounceMs: 180_000,
};

describe("computeReconcileDecision", () => {
  it("does not wake when there is no live CEO", () => {
    expect(
      computeReconcileDecision({ ...base, ceoId: null, counts: { todo: 5, doing: 0, review: 0 } }),
    ).toEqual({ wake: false });
  });

  it("does not wake when the CEO is already engaged", () => {
    expect(
      computeReconcileDecision({
        ...base,
        ceoEngaged: true,
        counts: { todo: 5, doing: 0, review: 0 },
      }),
    ).toEqual({ wake: false });
  });

  it("does not wake when there is no actionable work", () => {
    expect(computeReconcileDecision(base)).toEqual({ wake: false });
  });

  it("wakes the CEO when the whole team is idle but work remains (the observed stall)", () => {
    const d = computeReconcileDecision({ ...base, counts: { todo: 15, doing: 5, review: 10 } });
    expect(d.wake).toBe(true);
    if (d.wake) {
      expect(d.ceoId).toBe("ceo-1");
      expect(d.summary).toContain("ninguem esta progredindo");
      expect(d.summary).toContain("15 a fazer");
    }
  });

  it("wakes the CEO to review when workers are busy but items await review", () => {
    const d = computeReconcileDecision({
      ...base,
      anyWorkerEngaged: true,
      counts: { todo: 0, doing: 2, review: 3 },
    });
    expect(d.wake).toBe(true);
    if (d.wake) expect(d.summary).toContain("Revise cada tarefa");
  });

  it("does NOT wake when workers are progressing and nothing awaits the CEO", () => {
    expect(
      computeReconcileDecision({
        ...base,
        anyWorkerEngaged: true,
        counts: { todo: 4, doing: 2, review: 0 },
      }),
    ).toEqual({ wake: false });
  });

  it("respects the debounce after a recent wake", () => {
    expect(
      computeReconcileDecision({
        ...base,
        counts: { todo: 5, doing: 0, review: 0 },
        ceoLastWakeAt: base.now - 60_000, // 1 min ago < 3 min debounce
      }),
    ).toEqual({ wake: false });
  });

  it("wakes again once the debounce window has elapsed", () => {
    const d = computeReconcileDecision({
      ...base,
      counts: { todo: 5, doing: 0, review: 0 },
      ceoLastWakeAt: base.now - 200_000, // > 3 min ago
    });
    expect(d.wake).toBe(true);
  });

  it("wakes the CEO when a goal failed verification, even with an idle board", () => {
    const d = computeReconcileDecision({
      ceoId: "ceo1",
      ceoEngaged: false,
      anyWorkerEngaged: true,
      counts: { todo: 0, doing: 0, review: 0 },
      verificationFailedGoals: [{ id: "g1", title: "Ship X", failedCriteria: ["tests pass"] }],
      ceoLastWakeAt: null,
      now: 1000,
      debounceMs: 180000,
    });
    expect(d.wake).toBe(true);
    if (d.wake) expect(d.summary).toContain("Ship X");
  });

  it("does not wake with no failed goals and a calm board", () => {
    const d = computeReconcileDecision({
      ceoId: "ceo1",
      ceoEngaged: false,
      anyWorkerEngaged: true,
      counts: { todo: 0, doing: 0, review: 0 },
      verificationFailedGoals: [],
      ceoLastWakeAt: null,
      now: 1000,
      debounceMs: 180000,
    });
    expect(d.wake).toBe(false);
  });

  it("respects the debounce for failed-verification wakes", () => {
    const d = computeReconcileDecision({
      ceoId: "ceo1",
      ceoEngaged: false,
      anyWorkerEngaged: true,
      counts: { todo: 0, doing: 0, review: 0 },
      verificationFailedGoals: [{ id: "g1", title: "X", failedCriteria: [] }],
      ceoLastWakeAt: 1000,
      now: 1000 + 60_000,
      debounceMs: 180_000,
    });
    expect(d.wake).toBe(false);
  });
});
