import { describe, it, expect, vi } from "vitest";
import { collectStripeSales, type CollectStripeSalesDeps } from "./collect-stripe-sales.js";
import type { StripeCharge } from "./stripe-client.js";

const charge = (over: Partial<StripeCharge>): StripeCharge => ({
  id: "ch",
  amount: 900,
  currency: "brl",
  created: 1000,
  status: "succeeded",
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
