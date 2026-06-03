import { describe, it, expect, vi } from "vitest";
import {
  collectStripeSubscriptions,
  type CollectStripeSubscriptionsDeps,
} from "./collect-stripe-subscriptions.js";
import type { StripeSubscription } from "./stripe-client.js";

const sub = (over: Partial<StripeSubscription> = {}): StripeSubscription => ({
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  created: 1000,
  canceledAt: null,
  productId: "prod_1",
  productName: "Plano",
  amount: 1000,
  currency: "brl",
  interval: "month",
  ...over,
});

const baseDeps = (
  over: Partial<CollectStripeSubscriptionsDeps>,
): CollectStripeSubscriptionsDeps => ({
  listCompaniesWithStripe: () => ["c1"],
  getKey: () => "rk_test_x",
  listSubscriptions: () => Promise.resolve([]),
  record: () => undefined,
  now: () => 10_000,
  ...over,
});

describe("collectStripeSubscriptions", () => {
  it("records each subscription with its company", async () => {
    const recorded: string[] = [];
    await collectStripeSubscriptions(
      baseDeps({
        listSubscriptions: () => Promise.resolve([sub({ id: "a" }), sub({ id: "b" })]),
        record: (r) => recorded.push(`${r.companyId}:${r.id}`),
      }),
    );
    expect(recorded).toEqual(["c1:a", "c1:b"]);
  });

  it("is fail-soft: one company throwing does not stop the others", async () => {
    const seen: string[] = [];
    await collectStripeSubscriptions(
      baseDeps({
        listCompaniesWithStripe: () => ["bad", "good"],
        listSubscriptions: () => {
          seen.push("call");
          if (seen.length === 1) return Promise.reject(new Error("api down"));
          return Promise.resolve([]);
        },
      }),
    );
    expect(seen).toHaveLength(2);
  });

  it("is fail-soft even if listing the companies throws", async () => {
    const record = vi.fn();
    await collectStripeSubscriptions(
      baseDeps({
        listCompaniesWithStripe: () => {
          throw new Error("db down");
        },
        record,
      }),
    );
    expect(record).not.toHaveBeenCalled();
  });
});
