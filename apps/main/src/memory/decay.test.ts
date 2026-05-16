import { describe, it, expect } from "vitest";
import { decayFactor, decayedImportance } from "./decay.js";

describe("decayFactor", () => {
  it("is 1 when no time has elapsed", () => {
    expect(decayFactor(0, 0)).toBe(1);
  });

  it("is 1 for negative elapsed time (clock skew guard)", () => {
    expect(decayFactor(-5, 0)).toBe(1);
  });

  it("halves importance after one 90-day half-life with no access boost", () => {
    expect(decayFactor(90, 0)).toBeCloseTo(0.5, 5);
  });

  it("decays slower when the memory has been accessed often", () => {
    const cold = decayFactor(90, 0);
    const hot = decayFactor(90, 20);
    expect(hot).toBeGreaterThan(cold);
  });

  it("caps the access boost so it cannot stop decay entirely", () => {
    expect(decayFactor(90, 1000)).toBeCloseTo(decayFactor(90, 20), 5);
  });
});

describe("decayedImportance", () => {
  it("never returns a value above the input importance", () => {
    expect(decayedImportance(0.8, 0, 90)).toBeLessThan(0.8);
  });

  it("never returns a negative value", () => {
    expect(decayedImportance(0.8, 0, 100000)).toBeGreaterThanOrEqual(0);
  });

  it("leaves importance untouched when no time elapsed", () => {
    expect(decayedImportance(0.5, 3, 0)).toBe(0.5);
  });

  it("clamps the result to at most 1", () => {
    expect(decayedImportance(1.5, 0, 0)).toBe(1);
  });
});
