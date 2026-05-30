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
});
