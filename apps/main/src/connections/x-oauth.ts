import { createHash } from "node:crypto";
import { XApiError, type XHttp } from "./x-client.js";

// OAuth 2.0 (Authorization Code + PKCE, public client) for the X connector. PURE
// pieces: PKCE derivation, the authorize URL, and the token-endpoint calls (http +
// clock injected, so they're unit-testable). The browser-open + loopback callback
// server is electron wiring, built/verified live with the user's X app. Endpoints
// follow X API v2 — confirm against a real account in the smoke test.

const base64url = (buf: Buffer): string => buf.toString("base64url");

// PKCE: verifier = base64url(random bytes); challenge = base64url(SHA256(verifier)).
// randomBytes injected for deterministic tests (production: crypto.randomBytes(32)).
export const generatePkce = (randomBytes: Buffer): { verifier: string; challenge: string } => {
  const verifier = base64url(randomBytes);
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";

export const buildAuthorizeUrl = (p: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}): string => {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", p.scopes.join(" "));
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
};

export type XTokens = { accessToken: string; refreshToken: string; expiresAt: number };

const tokenRequest = async (
  http: XHttp,
  form: URLSearchParams,
  now: () => number,
): Promise<XTokens> => {
  const res = await http(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (res.status >= 400 || data.access_token === undefined) {
    throw new XApiError(
      res.status,
      data.error_description ?? data.error ?? `X token error ${String(res.status)}`,
    );
  }
  return {
    accessToken: data.access_token,
    // X rotates the refresh token; if a response omits it, the caller keeps the old one.
    refreshToken: data.refresh_token ?? "",
    expiresAt: now() + (data.expires_in ?? 0) * 1000,
  };
};

export const exchangeCode = (
  http: XHttp,
  p: { clientId: string; code: string; redirectUri: string; codeVerifier: string },
  now: () => number,
): Promise<XTokens> =>
  tokenRequest(
    http,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      redirect_uri: p.redirectUri,
      code_verifier: p.codeVerifier,
      client_id: p.clientId,
    }),
    now,
  );

export const refreshTokens = (
  http: XHttp,
  p: { clientId: string; refreshToken: string },
  now: () => number,
): Promise<XTokens> =>
  tokenRequest(
    http,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: p.refreshToken,
      client_id: p.clientId,
    }),
    now,
  );
