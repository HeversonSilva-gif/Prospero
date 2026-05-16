import { describe, it, expect } from "vitest";
import { createRecoveryTracker } from "./recovery-tracker.js";

describe("createRecoveryTracker", () => {
  it("consumeRecovery is false when the agent never errored", () => {
    const t = createRecoveryTracker();
    expect(t.consumeRecovery("a1")).toBe(false);
  });

  it("consumeRecovery is true once after the agent errored, then false", () => {
    const t = createRecoveryTracker();
    t.markErrored("a1");
    expect(t.consumeRecovery("a1")).toBe(true);
    expect(t.consumeRecovery("a1")).toBe(false);
  });

  it("tracks agents independently", () => {
    const t = createRecoveryTracker();
    t.markErrored("a1");
    expect(t.consumeRecovery("a2")).toBe(false);
    expect(t.consumeRecovery("a1")).toBe(true);
  });
});
