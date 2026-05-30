import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildAuthorizeUrl, generatePkce, exchangeCode, refreshTokens } from "./x-oauth.js";
import { XApiError, type XHttp } from "./x-client.js";

// OAuth 2.0 (Authorization Code + PKCE, public client) for the X connector. These are
// the PURE pieces — PKCE derivation, the authorize URL, and the token-endpoint calls
// (http + clock injected). The browser-open + loopback callback server is electron
// wiring, built + verified live with the user's X app. Endpoints follow X API v2;
// confirm against a real account in the smoke test.

type Init = { method: string; headers: Record<string, string>; body?: string };

describe("generatePkce", () => {
  it("derives a verifier + S256 challenge from random bytes (base64url, no padding)", () => {
    const bytes = Buffer.alloc(32, 7);
    const { verifier, challenge } = generatePkce(bytes);
    expect(verifier).toBe(bytes.toString("base64url"));
    expect(challenge).toBe(createHash("sha256").update(verifier).digest().toString("base64url"));
    expect(verifier).not.toMatch(/[+/=]/);
    expect(challenge).not.toMatch(/[+/=]/);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds the X authorize URL with PKCE + space-joined scopes", () => {
    const url = buildAuthorizeUrl({
      clientId: "cid",
      redirectUri: "http://127.0.0.1:8723/x/callback",
      scopes: ["tweet.read", "tweet.write", "offline.access"],
      state: "ST",
      codeChallenge: "CH",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8723/x/callback");
    expect(u.searchParams.get("scope")).toBe("tweet.read tweet.write offline.access");
    expect(u.searchParams.get("state")).toBe("ST");
    expect(u.searchParams.get("code_challenge")).toBe("CH");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("exchangeCode", () => {
  it("posts the auth code form to the token endpoint and returns tokens with expiresAt", async () => {
    let captured: { url: string; init: Init } | undefined;
    const http: XHttp = (url, init) => {
      captured = { url, init };
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ access_token: "AT", refresh_token: "RT", expires_in: 7200 }),
      });
    };
    const tokens = await exchangeCode(
      http,
      { clientId: "cid", code: "CODE", redirectUri: "http://cb", codeVerifier: "VER" },
      () => 1000,
    );
    expect(captured?.url).toBe("https://api.x.com/2/oauth2/token");
    expect(captured?.init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(captured?.init.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("CODE");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("code_verifier")).toBe("VER");
    expect(form.get("redirect_uri")).toBe("http://cb");
    expect(tokens).toEqual({
      accessToken: "AT",
      refreshToken: "RT",
      expiresAt: 1000 + 7200 * 1000,
    });
  });
});

describe("refreshTokens", () => {
  it("posts a refresh_token grant and returns the new tokens", async () => {
    let body: string | undefined;
    const http: XHttp = (_url, init) => {
      body = init.body;
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ access_token: "AT2", refresh_token: "RT2", expires_in: 100 }),
      });
    };
    const tokens = await refreshTokens(http, { clientId: "cid", refreshToken: "OLD" }, () => 0);
    const form = new URLSearchParams(body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("OLD");
    expect(form.get("client_id")).toBe("cid");
    expect(tokens).toEqual({ accessToken: "AT2", refreshToken: "RT2", expiresAt: 100000 });
  });

  it("throws XApiError on a token error", async () => {
    const http: XHttp = () =>
      Promise.resolve({ status: 400, json: () => Promise.resolve({ error: "invalid_grant" }) });
    await expect(
      refreshTokens(http, { clientId: "c", refreshToken: "x" }, () => 0),
    ).rejects.toBeInstanceOf(XApiError);
  });
});
