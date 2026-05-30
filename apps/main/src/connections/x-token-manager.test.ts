import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createConnectionsRepository, type Cipher } from "./connections-repository.js";
import { getValidXAccessToken } from "./x-token-manager.js";
import { type XHttp } from "./x-client.js";

const fakeCipher: Cipher = { encrypt: (p) => p, decrypt: (s) => s };

const setupRepo = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  return createConnectionsRepository(db, fakeCipher);
};

const noHttp: XHttp = () => Promise.reject(new Error("http should not be called"));

describe("getValidXAccessToken", () => {
  it("returns the stored access token when it is still valid (no refresh)", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "AT", refreshToken: "RT", expiresAt: 1_000_000 },
      { clientId: "cid" },
    );
    expect(await getValidXAccessToken(repo, noHttp, "c1", () => 0)).toBe("AT");
  });

  it("returns null when the company has no X connection", async () => {
    const repo = setupRepo();
    expect(await getValidXAccessToken(repo, noHttp, "c1", () => 0)).toBeNull();
  });

  it("refreshes and persists the new tokens when the access token is expired", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "OLD", refreshToken: "RT", expiresAt: 100 },
      { clientId: "cid" },
    );
    const http: XHttp = () =>
      Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({ access_token: "NEW", refresh_token: "RT2", expires_in: 7200 }),
      });
    expect(await getValidXAccessToken(repo, http, "c1", () => 1000)).toBe("NEW");
    expect(repo.load("c1", "x")?.payload).toEqual({
      accessToken: "NEW",
      refreshToken: "RT2",
      expiresAt: 1000 + 7200 * 1000,
    });
  });

  it("keeps the old refresh token if the refresh response omits a new one", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "OLD", refreshToken: "KEEP", expiresAt: 0 },
      { clientId: "cid" },
    );
    const http: XHttp = () =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ access_token: "NEW", expires_in: 100 }),
      });
    await getValidXAccessToken(repo, http, "c1", () => 0);
    expect(repo.load("c1", "x")?.payload).toMatchObject({ refreshToken: "KEEP" });
  });

  it("returns null when expired but there is no refresh token to use", async () => {
    const repo = setupRepo();
    repo.save(
      "c1",
      "x",
      { accessToken: "OLD", refreshToken: "", expiresAt: 0 },
      { clientId: "cid" },
    );
    expect(await getValidXAccessToken(repo, noHttp, "c1", () => 0)).toBeNull();
  });
});
