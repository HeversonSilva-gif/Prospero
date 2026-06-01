import { describe, it, expect, vi } from "vitest";
import { assessFinance, reviewFinance, type ReviewFinanceDeps } from "./finance-review.js";

describe("assessFinance", () => {
  it("at a loss when cost ≥ threshold and revenue is zero", () => {
    expect(assessFinance({ costCents: 150, revenueCents: 0, thresholdCents: 100 }).atLoss).toBe(
      true,
    );
  });
  it("not at a loss when there is any revenue", () => {
    expect(assessFinance({ costCents: 150, revenueCents: 10, thresholdCents: 100 }).atLoss).toBe(
      false,
    );
  });
  it("not at a loss when cost is below the threshold", () => {
    expect(assessFinance({ costCents: 50, revenueCents: 0, thresholdCents: 100 }).atLoss).toBe(
      false,
    );
  });
});

const baseDeps = (over: Partial<ReviewFinanceDeps>): ReviewFinanceDeps => ({
  listCompanies: () => ["c1"],
  windowCostCents: () => 0,
  windowRevenue: () => ({ totalCents: 0, byCurrency: {} }),
  windowMs: 7 * 24 * 60 * 60_000,
  thresholdCents: 100,
  now: () => 1_000_000,
  shouldNudge: () => true,
  onLoss: () => undefined,
  ...over,
});

describe("reviewFinance", () => {
  it("fires onLoss with a summary when a company is at a loss", () => {
    const onLoss = vi.fn();
    reviewFinance(
      baseDeps({
        windowCostCents: () => 250,
        windowRevenue: () => ({ totalCents: 0, byCurrency: {} }),
        onLoss,
      }),
    );
    expect(onLoss).toHaveBeenCalledTimes(1);
    expect(onLoss.mock.calls[0]?.[1]).toContain("2.50");
  });
  it("does not fire when there is revenue or when shouldNudge is false", () => {
    const onLoss = vi.fn();
    reviewFinance(
      baseDeps({
        windowCostCents: () => 250,
        windowRevenue: () => ({ totalCents: 900, byCurrency: { brl: 900 } }),
        onLoss,
      }),
    );
    reviewFinance(baseDeps({ windowCostCents: () => 250, shouldNudge: () => false, onLoss }));
    expect(onLoss).not.toHaveBeenCalled();
  });
  it("is fail-soft: one company throwing does not stop the others", () => {
    const seen: string[] = [];
    reviewFinance(
      baseDeps({
        listCompanies: () => ["bad", "good"],
        windowCostCents: (c) => {
          seen.push(c);
          if (c === "bad") throw new Error("db down");
          return 250;
        },
        windowRevenue: () => ({ totalCents: 0, byCurrency: {} }),
      }),
    );
    expect(seen).toEqual(["bad", "good"]);
  });
});
