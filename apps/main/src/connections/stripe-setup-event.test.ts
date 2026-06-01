import { describe, it, expect } from "vitest";
import { handleStripeSetupEvent } from "./stripe-setup-event.js";
import type { ConnectionsRepository } from "./connections-repository.js";
import type { StripeHttp } from "./stripe-client.js";

const repoWith = (key: string | null): ConnectionsRepository => ({
  save: () => undefined,
  load: () => (key === null ? null : { payload: { restrictedKey: key }, metadata: {} }),
  listMetadata: () => [],
  clear: () => undefined,
});

const okHttp: StripeHttp = (url) => {
  if (url.endsWith("/products"))
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "prod" }) });
  if (url.endsWith("/prices"))
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "price" }) });
  return Promise.resolve({
    status: 200,
    json: () => Promise.resolve({ id: "plink", url: "https://buy.stripe.com/x" }),
  });
};

describe("handleStripeSetupEvent", () => {
  it("writes an ok result with the payment link url", async () => {
    let result: unknown;
    await handleStripeSetupEvent(
      {
        repo: repoWith("rk_test_x"),
        http: okHttp,
        writeResult: (_id, r) => {
          result = r;
        },
      },
      "c1",
      { requestId: "r1", items: [{ name: "P", description: "d", amount: 900, currency: "brl" }] },
    );
    expect(result).toEqual({ ok: true, url: "https://buy.stripe.com/x", paymentLinkId: "plink" });
  });

  it("never throws — writes ok:false when Stripe is not connected", async () => {
    let result: { ok: boolean } | undefined;
    await handleStripeSetupEvent(
      {
        repo: repoWith(null),
        http: okHttp,
        writeResult: (_id, r) => {
          result = r;
        },
      },
      "c1",
      { requestId: "r1", items: [{ name: "P", description: "d", amount: 900, currency: "brl" }] },
    );
    expect(result?.ok).toBe(false);
  });
});
