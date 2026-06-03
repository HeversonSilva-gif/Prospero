import { describe, it, expect } from "vitest";
import {
  getAccount,
  validateStripeKeyShape,
  createProduct,
  createPrice,
  createPaymentLink,
  listCharges,
  StripeApiError,
  type StripeHttp,
} from "./stripe-client.js";

type Init = { method: string; headers: Record<string, string>; body?: string };

describe("validateStripeKeyShape", () => {
  it("accepts a live restricted key and reports livemode", () => {
    expect(validateStripeKeyShape("rk_live_abc")).toEqual({ ok: true, livemode: true });
  });
  it("accepts a test restricted key", () => {
    expect(validateStripeKeyShape("rk_test_abc")).toEqual({ ok: true, livemode: false });
  });
  it("rejects a publishable key", () => {
    expect(validateStripeKeyShape("pk_test_abc").ok).toBe(false);
  });
  it("rejects a full secret key", () => {
    expect(validateStripeKeyShape("sk_live_abc").ok).toBe(false);
  });
  it("rejects garbage", () => {
    expect(validateStripeKeyShape("hello").ok).toBe(false);
  });
});

describe("stripe-client getAccount", () => {
  it("GETs /v1/account with the bearer key and maps the display name", async () => {
    let captured: { url: string; init: Init } | undefined;
    const http: StripeHttp = (url, init) => {
      captured = { url, init };
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            id: "acct_1",
            email: "a@b.com",
            country: "BR",
            settings: { dashboard: { display_name: "Aurora" } },
          }),
      });
    };
    const acc = await getAccount(http, "rk_test_x");
    expect(captured?.url).toBe("https://api.stripe.com/v1/account");
    expect(captured?.init.method).toBe("GET");
    expect(captured?.init.headers.Authorization).toBe("Bearer rk_test_x");
    expect(acc).toEqual({ id: "acct_1", displayName: "Aurora", email: "a@b.com", country: "BR" });
  });

  it("falls back to business_profile.name then email then id", async () => {
    const http: StripeHttp = () =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ id: "acct_2", business_profile: { name: "Velas" } }),
      });
    const acc = await getAccount(http, "rk_test_x");
    expect(acc.displayName).toBe("Velas");
  });

  it("throws StripeApiError with the Stripe message on error", async () => {
    const http: StripeHttp = () =>
      Promise.resolve({
        status: 401,
        json: () => Promise.resolve({ error: { message: "Invalid API Key provided" } }),
      });
    await expect(getAccount(http, "bad")).rejects.toBeInstanceOf(StripeApiError);
  });
});

describe("stripe-client createProduct / createPrice / createPaymentLink", () => {
  it("POSTs a form-encoded product and returns its id", async () => {
    let captured: { url: string; init: Init } | undefined;
    const http: StripeHttp = (url, init) => {
      captured = { url, init };
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "prod_1" }) });
    };
    const r = await createProduct(http, "rk_test_x", { name: "Plano", description: "acesso" });
    expect(captured?.url).toBe("https://api.stripe.com/v1/products");
    expect(captured?.init.method).toBe("POST");
    expect(captured?.init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(captured?.init.body).toBe("name=Plano&description=acesso");
    expect(r).toEqual({ id: "prod_1" });
  });

  it("sends an Idempotency-Key header when one is provided (I6)", async () => {
    let captured: { url: string; init: Init } | undefined;
    const http: StripeHttp = (url, init) => {
      captured = { url, init };
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "prod_1" }) });
    };
    await createProduct(http, "rk_test_x", { name: "Plano", description: "x" }, "idem-abc");
    expect(captured?.init.headers["Idempotency-Key"]).toBe("idem-abc");
  });

  it("omits the Idempotency-Key header when none is provided", async () => {
    let captured: { url: string; init: Init } | undefined;
    const http: StripeHttp = (url, init) => {
      captured = { url, init };
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "prod_1" }) });
    };
    await createProduct(http, "rk_test_x", { name: "Plano", description: "x" });
    expect(captured?.init.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("POSTs a one-time price (no recurring) ", async () => {
    let body: string | undefined;
    const http: StripeHttp = (_url, init) => {
      body = init.body;
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "price_1" }) });
    };
    await createPrice(http, "rk_test_x", { product: "prod_1", unitAmount: 900, currency: "brl" });
    expect(body).toBe("product=prod_1&unit_amount=900&currency=brl");
  });

  it("POSTs a recurring price with the interval bracket param", async () => {
    let body: string | undefined;
    const http: StripeHttp = (_url, init) => {
      body = init.body;
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "price_2" }) });
    };
    await createPrice(http, "rk_test_x", {
      product: "prod_1",
      unitAmount: 900,
      currency: "brl",
      interval: "month",
    });
    expect(body).toContain("recurring%5Binterval%5D=month");
  });

  it("POSTs a payment link with bracketed line items and returns the url", async () => {
    let body: string | undefined;
    const http: StripeHttp = (_url, init) => {
      body = init.body;
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ id: "plink_1", url: "https://buy.stripe.com/x" }),
      });
    };
    const r = await createPaymentLink(http, "rk_test_x", {
      lineItems: [{ price: "price_1", quantity: 1 }],
    });
    expect(body).toContain("line_items%5B0%5D%5Bprice%5D=price_1");
    expect(body).toContain("line_items%5B0%5D%5Bquantity%5D=1");
    expect(r).toEqual({ id: "plink_1", url: "https://buy.stripe.com/x" });
  });

  it("throws StripeApiError when payment link creation fails", async () => {
    const http: StripeHttp = () =>
      Promise.resolve({
        status: 402,
        json: () => Promise.resolve({ error: { message: "no such price" } }),
      });
    await expect(
      createPaymentLink(http, "rk_test_x", { lineItems: [{ price: "x", quantity: 1 }] }),
    ).rejects.toBeInstanceOf(StripeApiError);
  });
});

describe("stripe-client listCharges", () => {
  it("GETs charges with limit + created[gte] (seconds) and maps created to ms", async () => {
    let captured: { url: string; init: Init } | undefined;
    const http: StripeHttp = (url, init) => {
      captured = { url, init };
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              { id: "ch_1", amount: 900, currency: "brl", created: 1000, status: "succeeded" },
            ],
          }),
      });
    };
    const charges = await listCharges(http, "rk_test_x", { createdGte: 5_000_000, limit: 10 });
    expect(captured?.url).toContain("https://api.stripe.com/v1/charges?");
    expect(captured?.url).toContain("limit=10");
    expect(captured?.url).toContain("created%5Bgte%5D=5000");
    expect(charges[0]).toEqual({
      id: "ch_1",
      amount: 900,
      currency: "brl",
      created: 1_000_000,
      status: "succeeded",
      amountRefunded: 0,
      disputed: false,
      customer: null,
    });
  });

  it("maps amount_refunded, dispute (as full refund) and customer (I5)", async () => {
    const http: StripeHttp = () =>
      Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              // partial refund
              {
                id: "ch_r",
                amount: 1000,
                amount_refunded: 400,
                currency: "brl",
                created: 1000,
                status: "succeeded",
                customer: "cus_1",
              },
              // disputed: treated as a full refund (net 0)
              {
                id: "ch_d",
                amount: 2000,
                amount_refunded: 0,
                disputed: true,
                currency: "brl",
                created: 2000,
                status: "succeeded",
                customer: null,
              },
            ],
          }),
      });
    const charges = await listCharges(http, "rk_test_x");
    expect(charges[0]).toMatchObject({ amountRefunded: 400, customer: "cus_1", disputed: false });
    expect(charges[1]).toMatchObject({ amountRefunded: 2000, disputed: true, customer: null });
  });

  it("returns [] when there is no data and throws on error", async () => {
    const empty: StripeHttp = () =>
      Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
    expect(await listCharges(empty, "rk_test_x")).toEqual([]);
    const err: StripeHttp = () =>
      Promise.resolve({ status: 401, json: () => Promise.resolve({ error: { message: "bad" } }) });
    await expect(listCharges(err, "bad")).rejects.toBeInstanceOf(StripeApiError);
  });
});
