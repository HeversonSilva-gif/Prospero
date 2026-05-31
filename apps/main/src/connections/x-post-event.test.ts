import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createConnectionsRepository, type Cipher } from "./connections-repository.js";
import { handleXPostEvent, type XPostEventResult } from "./x-post-event.js";
import { type XHttp } from "./x-client.js";

// handleXPostEvent is the MAIN-process reaction to the `x.post` side-channel event
// the post_to_x / reply_on_x tools emit AFTER passing the approval gate. It runs
// the real post (only MAIN has the safeStorage cipher to decrypt the token) and
// writes the result back so the waiting tool can return the tweet URL to the agent.
const fakeCipher: Cipher = { encrypt: (p) => p, decrypt: (s) => s };

const setupRepo = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  return createConnectionsRepository(db, fakeCipher);
};

describe("handleXPostEvent", () => {
  it("posts and writes an ok result keyed by postId", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "AT", refreshToken: "RT", expiresAt: 9_999_999_999 },
      { clientId: "cid" },
    );
    const http: XHttp = () =>
      Promise.resolve({ status: 201, json: () => Promise.resolve({ data: { id: "777" } }) });
    const written: Record<string, XPostEventResult> = {};
    await handleXPostEvent(
      { repo, http, writeResult: (id, r) => (written[id] = r), now: () => 0 },
      "c1",
      { postId: "p1", text: "hello" },
    );
    expect(written.p1).toEqual({ ok: true, id: "777", url: "https://x.com/i/status/777" });
  });

  it("forwards inReplyToId so a reply is threaded", async () => {
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
      return Promise.resolve({ status: 201, json: () => Promise.resolve({ data: { id: "9" } }) });
    };
    const written: Record<string, XPostEventResult> = {};
    await handleXPostEvent(
      { repo, http, writeResult: (id, r) => (written[id] = r), now: () => 0 },
      "c1",
      { postId: "p2", text: "re", inReplyToId: "555" },
    );
    expect(body).toEqual({ text: "re", reply: { in_reply_to_tweet_id: "555" } });
    expect(written.p2).toEqual({ ok: true, id: "9", url: "https://x.com/i/status/9" });
  });

  it("writes a failure result (never throws) when the company has no X connection", async () => {
    const repo = setupRepo();
    const http: XHttp = () => Promise.reject(new Error("should not be called"));
    const written: Record<string, XPostEventResult> = {};
    await handleXPostEvent(
      { repo, http, writeResult: (id, r) => (written[id] = r), now: () => 0 },
      "c1",
      { postId: "p3", text: "x" },
    );
    const r = written.p3;
    expect(r).toBeDefined();
    if (r !== undefined && r.ok === false) expect(r.error).toMatch(/conectad/i);
    else expect.fail("expected a failure result");
  });
});
