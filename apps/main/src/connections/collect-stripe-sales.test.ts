import { describe, it, expect, vi } from "vitest";
import { collectStripeSales, type CollectStripeSalesDeps } from "./collect-stripe-sales.js";
import type { StripeCharge } from "./stripe-client.js";

const charge = (over: Partial<StripeCharge>): StripeCharge => ({
  id: "ch",
  amount: 900,
  currency: "brl",
  created: 1000,
  status: "succeeded",
  amountRefunded: 0,
  disputed: false,
  customer: null,
  ...over,
});

const baseDeps = (over: Partial<CollectStripeSalesDeps>): CollectStripeSalesDeps => ({
  listCompaniesWithStripe: () => ["c1"],
  getKey: () => "rk_test_x",
  listCharges: () => Promise.resolve([]),
  countExisting: () => 0,
  record: () => true,
  onFirstSale: () => undefined,
  windowMs: 1000,
  now: () => 10_000,
  ...over,
});

describe("collectStripeSales", () => {
  it("records succeeded charges and fires onFirstSale once when there were none before", async () => {
    const recorded: string[] = [];
    const onFirstSale = vi.fn();
    await collectStripeSales(
      baseDeps({
        countExisting: () => 0,
        listCharges: () =>
          Promise.resolve([charge({ id: "ch_1" }), charge({ id: "ch_2", amount: 500 })]),
        record: (i) => {
          recorded.push(i.id);
          return true;
        },
        onFirstSale,
      }),
    );
    expect(recorded).toEqual(["ch_1", "ch_2"]);
    expect(onFirstSale).toHaveBeenCalledTimes(1);
    expect(onFirstSale).toHaveBeenCalledWith("c1", { amount: 900, currency: "brl" });
  });

  it("skips non-succeeded charges", async () => {
    const recorded: string[] = [];
    await collectStripeSales(
      baseDeps({
        listCharges: () =>
          Promise.resolve([charge({ id: "ok" }), charge({ id: "pending", status: "pending" })]),
        record: (i) => {
          recorded.push(i.id);
          return true;
        },
      }),
    );
    expect(recorded).toEqual(["ok"]);
  });

  it("does NOT fire onFirstSale when the company already had payments", async () => {
    const onFirstSale = vi.fn();
    await collectStripeSales(
      baseDeps({
        countExisting: () => 3,
        listCharges: () => Promise.resolve([charge({ id: "ch_9" })]),
        onFirstSale,
      }),
    );
    expect(onFirstSale).not.toHaveBeenCalled();
  });

  it("fires onFirstSale with the EARLIEST new charge, not the newest (M3)", async () => {
    // Stripe returns newest-first; the first sale is the oldest one.
    const onFirstSale = vi.fn();
    await collectStripeSales(
      baseDeps({
        countExisting: () => 0,
        listCharges: () =>
          Promise.resolve([
            charge({ id: "newer", amount: 999, created: 5000 }),
            charge({ id: "older", amount: 100, created: 2000 }),
          ]),
        onFirstSale,
      }),
    );
    expect(onFirstSale).toHaveBeenCalledWith("c1", { amount: 100, currency: "brl" });
  });

  it("passes amount_refunded + customer through to record (I5)", async () => {
    const recorded: Array<{ amountRefunded?: number; customerId?: string | null }> = [];
    await collectStripeSales(
      baseDeps({
        listCharges: () =>
          Promise.resolve([charge({ id: "ch_r", amountRefunded: 300, customer: "cus_9" })]),
        record: (i) => {
          recorded.push({ amountRefunded: i.amountRefunded, customerId: i.customerId });
          return true;
        },
      }),
    );
    expect(recorded[0]).toEqual({ amountRefunded: 300, customerId: "cus_9" });
  });

  it("backfills from the last recorded charge when older than the window (M3 cursor)", async () => {
    let sinceArg = -1;
    await collectStripeSales(
      baseDeps({
        now: () => 1_000_000,
        windowMs: 1000, // window start = 999_000
        lastCreatedAt: () => 10_000, // far older than the window → backfill from here
        listCharges: (_key, sinceMs) => {
          sinceArg = sinceMs;
          return Promise.resolve([]);
        },
      }),
    );
    expect(sinceArg).toBe(10_000);
  });

  it("uses the normal window when the last charge is recent (M3 cursor)", async () => {
    let sinceArg = -1;
    await collectStripeSales(
      baseDeps({
        now: () => 1_000_000,
        windowMs: 1000,
        lastCreatedAt: () => 999_500, // inside the window → use window start
        listCharges: (_key, sinceMs) => {
          sinceArg = sinceMs;
          return Promise.resolve([]);
        },
      }),
    );
    expect(sinceArg).toBe(999_000);
  });

  it("is fail-soft: one company throwing does not stop the others", async () => {
    const seen: string[] = [];
    await collectStripeSales(
      baseDeps({
        listCompaniesWithStripe: () => ["bad", "good"],
        getKey: (c) => (c === "bad" ? "rk" : "rk"),
        listCharges: (_key) => {
          // first call (bad) throws, second (good) returns empty
          seen.push("call");
          if (seen.length === 1) return Promise.reject(new Error("api down"));
          return Promise.resolve([]);
        },
      }),
    );
    expect(seen).toHaveLength(2);
  });
});
