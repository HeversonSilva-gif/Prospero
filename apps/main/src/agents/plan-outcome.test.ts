import { describe, it, expect } from "vitest";
import { decidePlanOutcome } from "./plan-outcome.js";

describe("decidePlanOutcome", () => {
  it("revises when flagged and under cap", () => {
    expect(decidePlanOutcome({ flaggedCount: 2, attempts: 0, cap: 1 })).toBe("revise");
  });
  it("surfaces at the cap", () => {
    expect(decidePlanOutcome({ flaggedCount: 2, attempts: 1, cap: 1 })).toBe("surface");
  });
  it("surfaces when nothing flagged", () => {
    expect(decidePlanOutcome({ flaggedCount: 0, attempts: 0, cap: 1 })).toBe("surface");
  });
});
