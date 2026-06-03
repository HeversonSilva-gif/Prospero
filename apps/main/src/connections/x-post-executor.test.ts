import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createConnectionsRepository, type Cipher } from "./connections-repository.js";
import { executeXPost } from "./x-post-executor.js";
import { type XHttp } from "./x-client.js";

// executeXPost is the main-process action behind the post_to_x / reply_on_x MCP
// tools: it gets a valid token for the company (refreshing if needed) and posts.
// It runs ONLY after the agent's tool call is approved (the gate routes the
// outward tool through request_permission first).
const fakeCipher: Cipher = { encrypt: (p) => p, decrypt: (s) => s };

const setupRepo = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  return createConnectionsRepository(db, fakeCipher);
};

describe("executeXPost", () => {
  it("posts with the company's valid token and returns the tweet result", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "AT", refreshToken: "RT", expiresAt: 9_999_999_999 },
      { clientId: "cid" },
    );
    let auth: string | undefined;
    const http: XHttp = (_url, init) => {
      auth = init.headers.Authorization;
      return Promise.resolve({ status: 201, json: () => Promise.resolve({ data: { id: "777" } }) });
    };
    const res = await executeXPost(repo, http, "c1", "hello world", {}, () => 0);
    expect(auth).toBe("Bearer AT");
    expect(res).toEqual({ id: "777", url: "https://x.com/i/status/777" });
  });

  it("posts a reply when inReplyToId is given", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "AT", refreshToken: "RT", expiresAt: 9_999_999_999 },
      { clientId: "cid" },
    );
    let body: unknown;
    const http: XHttp = (_url, init) => {
      body = JSON.parse(init.body ?? "{}");
      return Promise.resolve({ status: 201, json: () => Promise.resolve({ data: { id: "1" } }) });
    };
    await executeXPost(repo, http, "c1", "re", { inReplyToId: "999" }, () => 0);
    expect(body).toEqual({ text: "re", reply: { in_reply_to_tweet_id: "999" } });
  });

  it("throws a clear error when the company has no X connection", async () => {
    const repo = setupRepo();
    const http: XHttp = () => Promise.reject(new Error("should not be called"));
    await expect(executeXPost(repo, http, "c1", "x", {}, () => 0)).rejects.toThrow(/conectad/i);
  });

  it("refreshes the OAuth token and retries once when the post gets a 401 mid-flight", async () => {
    // I8 (audit 2026-06-03 Conectores): X rotates/revokes the refresh token
    // aggressively, so a stored access token can be valid-by-expiry yet rejected
    // mid-flight. On a 401 from the write, refresh once and retry exactly once.
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "STALE", refreshToken: "RT", expiresAt: 9_999_999_999 },
      { clientId: "cid" },
    );
    const auths: (string | undefined)[] = [];
    let call = 0;
    const http: XHttp = (url, init) => {
      auths.push(init.headers.Authorization);
      call += 1;
      if (url.includes("/oauth2/token")) {
        // refresh succeeds with a brand-new access token
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({ access_token: "FRESH", refresh_token: "RT2", expires_in: 7200 }),
        });
      }
      // first post 401s, the retry (after refresh) succeeds
      if (call === 1) return Promise.resolve({ status: 401, json: () => Promise.resolve({}) });
      return Promise.resolve({ status: 201, json: () => Promise.resolve({ data: { id: "888" } }) });
    };
    const res = await executeXPost(repo, http, "c1", "hello", {}, () => 0);
    expect(res).toEqual({ id: "888", url: "https://x.com/i/status/888" });
    // the retry used the freshly-refreshed token, and the new tokens were persisted
    expect(auths).toContain("Bearer FRESH");
    expect(repo.load("c1", "x")?.payload).toMatchObject({
      accessToken: "FRESH",
      refreshToken: "RT2",
    });
  });

  it("does not retry more than once: a 401 on the retry surfaces the error", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "STALE", refreshToken: "RT", expiresAt: 9_999_999_999 },
      { clientId: "cid" },
    );
    let posts = 0;
    const http: XHttp = (url) => {
      if (url.includes("/oauth2/token")) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ access_token: "FRESH", expires_in: 7200 }),
        });
      }
      posts += 1;
      return Promise.resolve({ status: 401, json: () => Promise.resolve({}) });
    };
    await expect(executeXPost(repo, http, "c1", "x", {}, () => 0)).rejects.toMatchObject({
      status: 401,
    });
    expect(posts).toBe(2); // original + exactly one retry, no more
  });

  it("surfaces the 401 when the token cannot be refreshed (no refresh token)", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "STALE", refreshToken: "", expiresAt: 9_999_999_999 },
      { clientId: "cid" },
    );
    let posts = 0;
    const http: XHttp = () => {
      posts += 1;
      return Promise.resolve({ status: 401, json: () => Promise.resolve({}) });
    };
    await expect(executeXPost(repo, http, "c1", "x", {}, () => 0)).rejects.toMatchObject({
      status: 401,
    });
    expect(posts).toBe(1); // no refresh possible → no retry
  });
});
