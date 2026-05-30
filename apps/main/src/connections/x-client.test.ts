import { describe, it, expect } from "vitest";
import { postTweet, XApiError, type XHttp } from "./x-client.js";

// `postTweet` is a thin, electron-free HTTP client over the X v2 "create tweet"
// endpoint. We inject the HTTP fn so we can assert the EXACT request shape (url,
// method, auth header, body) without a live call. The live contract (does X accept
// it) is confirmed in the smoke test once the user connects a real account.
// The fakes are non-async (return Promise.resolve) to satisfy require-await.

type Init = { method: string; headers: Record<string, string>; body?: string };

describe("x-client postTweet", () => {
  it("POSTs the tweet with a bearer token and returns id + url", async () => {
    const calls: Array<{ url: string; init: Init }> = [];
    const http: XHttp = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ status: 201, json: () => Promise.resolve({ data: { id: "123" } }) });
    };
    const res = await postTweet(http, "TOKEN", "hi");
    expect(calls[0]?.url).toBe("https://api.x.com/2/tweets");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers.Authorization).toBe("Bearer TOKEN");
    expect(calls[0]?.init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({ text: "hi" });
    expect(res).toEqual({ id: "123", url: "https://x.com/i/status/123" });
  });

  it("adds the reply field when replying to a tweet", async () => {
    let body: unknown;
    const http: XHttp = (_url, init) => {
      body = JSON.parse(init.body ?? "{}");
      return Promise.resolve({ status: 201, json: () => Promise.resolve({ data: { id: "456" } }) });
    };
    await postTweet(http, "T", "yo", { inReplyToId: "999" });
    expect(body).toEqual({ text: "yo", reply: { in_reply_to_tweet_id: "999" } });
  });

  it("throws a 401 XApiError so the caller can refresh + retry", async () => {
    const http: XHttp = () =>
      Promise.resolve({ status: 401, json: () => Promise.resolve({ title: "Unauthorized" }) });
    await expect(postTweet(http, "BAD", "x")).rejects.toBeInstanceOf(XApiError);
    await expect(postTweet(http, "BAD", "x")).rejects.toMatchObject({ status: 401 });
  });

  it("throws on other API errors with the X-provided detail", async () => {
    const http: XHttp = () =>
      Promise.resolve({
        status: 403,
        json: () => Promise.resolve({ detail: "duplicate content" }),
      });
    await expect(postTweet(http, "T", "x")).rejects.toMatchObject({
      status: 403,
      message: "duplicate content",
    });
  });
});
