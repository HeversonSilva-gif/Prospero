import { describe, it, expect, vi } from "vitest";
import { assessGrowth, reviewXGrowth } from "./x-growth-review.js";
import type { AccountSnapshot } from "./x-metrics-repository.js";

const series = (...f: number[]): AccountSnapshot[] =>
  f.map((followers, i) => ({ followers, capturedAt: i * 1000 }));

describe("assessGrowth", () => {
  it("flags stagnation when followers barely moved over the window", () => {
    expect(assessGrowth(series(100, 100, 101)).stagnant).toBe(true);
  });
  it("does not flag healthy growth", () => {
    expect(assessGrowth(series(100, 140)).stagnant).toBe(false);
  });
  it("does not flag (or crash) with fewer than 2 data points", () => {
    expect(assessGrowth(series(100)).stagnant).toBe(false);
    expect(assessGrowth([]).stagnant).toBe(false);
  });
});

describe("reviewXGrowth", () => {
  const baseDeps = () => ({
    listCompaniesWithX: () => ["c1", "c2"],
    accountSeries: vi.fn((companyId: string) =>
      companyId === "c1" ? series(100, 100) : series(100, 200),
    ),
    windowMs: 7 * 24 * 60 * 60_000,
    now: () => 1_000_000,
    shouldNudge: vi.fn(() => true),
    onStagnant: vi.fn(),
  });

  it("nudges only the stagnant company", () => {
    const d = baseDeps();
    reviewXGrowth(d);
    expect(d.onStagnant).toHaveBeenCalledTimes(1);
    expect(d.onStagnant).toHaveBeenCalledWith("c1", expect.stringContaining("estagnad"));
  });

  it("respects shouldNudge (de-dup) and is fail-soft", () => {
    const d = baseDeps();
    d.shouldNudge = vi.fn(() => false);
    reviewXGrowth(d);
    expect(d.onStagnant).not.toHaveBeenCalled();

    const d2 = baseDeps();
    d2.accountSeries = vi.fn(() => {
      throw new Error("db down");
    });
    expect(() => reviewXGrowth(d2)).not.toThrow(); // one company throwing doesn't break the loop
  });
});
