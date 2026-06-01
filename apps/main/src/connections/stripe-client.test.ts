import { describe, it, expect } from "vitest";
import {
  getAccount,
  validateStripeKeyShape,
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
