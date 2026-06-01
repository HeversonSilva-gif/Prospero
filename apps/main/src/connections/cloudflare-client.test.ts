import { describe, it, expect } from "vitest";
import { getAccount, CloudflareApiError, type CloudflareHttp } from "./cloudflare-client.js";

type Init = { method: string; headers: Record<string, string>; body?: string };

describe("cloudflare-client getAccount", () => {
  it("GETs /accounts with the bearer token and returns the first account", async () => {
    let captured: { url: string; init: Init } | undefined;
    const http: CloudflareHttp = (url, init) => {
      captured = { url, init };
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            result: [
              { id: "acc_1", name: "Aurora's Account" },
              { id: "acc_2", name: "Other" },
            ],
          }),
      });
    };
    const acc = await getAccount(http, "tok_123");
    expect(captured?.url).toBe("https://api.cloudflare.com/client/v4/accounts");
    expect(captured?.init.method).toBe("GET");
    expect(captured?.init.headers.Authorization).toBe("Bearer tok_123");
    expect(acc).toEqual({ id: "acc_1", name: "Aurora's Account" });
  });

  it("throws CloudflareApiError when the token is invalid", async () => {
    const http: CloudflareHttp = () =>
      Promise.resolve({
        status: 400,
        json: () => Promise.resolve({ success: false, errors: [{ message: "Invalid API Token" }] }),
      });
    await expect(getAccount(http, "bad")).rejects.toBeInstanceOf(CloudflareApiError);
  });

  it("throws when the token authenticates but has no accounts", async () => {
    const http: CloudflareHttp = () =>
      Promise.resolve({ status: 200, json: () => Promise.resolve({ success: true, result: [] }) });
    await expect(getAccount(http, "tok")).rejects.toBeInstanceOf(CloudflareApiError);
  });
});
