import { describe, it, expect } from "vitest";
import { executeStripeSetup } from "./stripe-monetization-executor.js";
import type { ConnectionsRepository } from "./connections-repository.js";
import type { StripeHttp } from "./stripe-client.js";

const repoWith = (key: string | null): ConnectionsRepository => ({
  save: () => undefined,
  load: () => (key === null ? null : { payload: { restrictedKey: key }, metadata: {} }),
  listMetadata: () => [],
  clear: () => undefined,
});

const fakeHttp =
  (calls: string[]): StripeHttp =>
  (url, init) => {
    calls.push(`${init.method} ${url}`);
    if (url.endsWith("/products"))
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "prod_1" }) });
    if (url.endsWith("/prices"))
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "price_1" }) });
    if (url.endsWith("/payment_links"))
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ id: "plink_1", url: "https://buy.stripe.com/x" }),
      });
    return Promise.resolve({ status: 404, json: () => Promise.resolve({}) });
  };

describe("executeStripeSetup", () => {
  it("creates product+price+link and returns the url", async () => {
    const calls: string[] = [];
    const r = await executeStripeSetup(repoWith("rk_test_x"), fakeHttp(calls), "c1", [
      { name: "Plano", description: "acesso", amount: 900, currency: "brl", interval: "month" },
    ]);
    expect(r).toEqual({ url: "https://buy.stripe.com/x", paymentLinkId: "plink_1" });
    expect(calls.some((c) => c.includes("/products"))).toBe(true);
    expect(calls.some((c) => c.includes("/prices"))).toBe(true);
    expect(calls.some((c) => c.includes("/payment_links"))).toBe(true);
  });

  it("sends a deterministic Idempotency-Key on every create call (I6)", async () => {
    const keysFor = async (): Promise<Array<string | undefined>> => {
      const keys: Array<string | undefined> = [];
      const http: StripeHttp = (url, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        if (url.endsWith("/products"))
          return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "prod_1" }) });
        if (url.endsWith("/prices"))
          return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "price_1" }) });
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ id: "plink_1", url: "https://buy.stripe.com/x" }),
        });
      };
      await executeStripeSetup(repoWith("rk_test_x"), http, "c1", [
        { name: "Plano", description: "acesso", amount: 900, currency: "brl", interval: "month" },
      ]);
      return keys;
    };
    const run1 = await keysFor();
    const run2 = await keysFor();
    // product, price, payment_link all carry a key…
    expect(run1).toHaveLength(3);
    expect(run1.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
    // …and a re-run with identical inputs reuses the SAME keys ⇒ Stripe dedupes.
    expect(run2).toEqual(run1);
  });

  it("throws a clear error when Stripe is not connected", async () => {
    await expect(
      executeStripeSetup(repoWith(null), fakeHttp([]), "c1", [
        { name: "x", description: "y", amount: 1, currency: "brl" },
      ]),
    ).rejects.toThrow(/não conectado/);
  });

  it("throws when there are no items", async () => {
    await expect(
      executeStripeSetup(repoWith("rk_test_x"), fakeHttp([]), "c1", []),
    ).rejects.toThrow();
  });
});
