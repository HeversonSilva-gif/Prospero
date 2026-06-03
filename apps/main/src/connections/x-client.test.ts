import { describe, it, expect } from "vitest";
import {
  postTweet,
  getMe,
  getUserMetrics,
  getTweetMetrics,
  XApiError,
  type XHttp,
} from "./x-client.js";

// `postTweet` is a thin, electron-free HTTP client over the X v2 "create tweet"
// endpoint. We inject the HTTP fn so we can assert the EXACT request shape (url,
// method, auth header, body) without a live call. The live contract (does X accept
// it) is confirmed in the smoke test once the user connects a real account.
// The fakes are non-async (return Promise.resolve) to satisfy require-await.

type Init = { method: string; headers: Record<string, string>; body?: string };

describe("x-client getMe", () => {
  it("GETs the authenticated user's id + handle with the bearer token", async () => {
    let captured: { url: string; init: Init } | undefined;
    const http: XHttp = (url, init) => {
      captured = { url, init };
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ data: { id: "42", username: "me" } }),
      });
    };
    const me = await getMe(http, "TOK");
    expect(captured?.url).toBe("https://api.x.com/2/users/me");
    expect(captured?.init.method).toBe("GET");
    expect(captured?.init.headers.Authorization).toBe("Bearer TOK");
    expect(me).toEqual({ id: "42", username: "me" });
  });

  it("throws XApiError on 401", async () => {
    const http: XHttp = () => Promise.resolve({ status: 401, json: () => Promise.resolve({}) });
    await expect(getMe(http, "BAD")).rejects.toBeInstanceOf(XApiError);
  });
});

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

describe("getUserMetrics", () => {
  it("requests public_metrics and parses the counts", async () => {
    let url = "";
    const http: XHttp = (u, init) => {
      url = u;
      expect(init.headers.Authorization).toBe("Bearer AT");
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            data: {
              public_metrics: { followers_count: 100, following_count: 10, tweet_count: 42 },
            },
          }),
      });
    };
    const m = await getUserMetrics(http, "AT");
    expect(url).toContain("user.fields=public_metrics");
    expect(m).toEqual({ followers: 100, following: 10, tweets: 42 });
  });
  it("throws XApiError on 401", async () => {
    const http: XHttp = () => Promise.resolve({ status: 401, json: () => Promise.resolve({}) });
    await expect(getUserMetrics(http, "AT")).rejects.toBeInstanceOf(XApiError);
  });
  it("surfaces the Retry-After header (seconds) on a 429 so the poller can back off", async () => {
    // I8 (audit 2026-06-03 Conectores): respect X's rate-limit back-off instead of
    // hammering. Retry-After is delta-seconds; we expose it as retryAfterMs.
    const http: XHttp = () =>
      Promise.resolve({
        status: 429,
        headers: { get: (n) => (n.toLowerCase() === "retry-after" ? "90" : null) },
        json: () => Promise.resolve({}),
      });
    await expect(getUserMetrics(http, "AT")).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 90_000,
    });
  });
});

describe("getTweetMetrics", () => {
  it("requests the ids with public_metrics and maps each tweet", async () => {
    let url = "";
    const http: XHttp = (u) => {
      url = u;
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: "t1",
                public_metrics: {
                  impression_count: 500,
                  like_count: 9,
                  reply_count: 2,
                  retweet_count: 3,
                  quote_count: 1,
                },
              },
            ],
          }),
      });
    };
    const out = await getTweetMetrics(http, "AT", ["t1", "t2"]);
    expect(url).toContain("ids=t1,t2");
    expect(url).toContain("tweet.fields=public_metrics");
    expect(out).toEqual([
      { id: "t1", impressions: 500, likes: 9, replies: 2, reposts: 3, quotes: 1 },
    ]);
  });
  it("returns [] for an empty id list without calling http", async () => {
    const http: XHttp = () => Promise.reject(new Error("should not be called"));
    expect(await getTweetMetrics(http, "AT", [])).toEqual([]);
  });
});
