import type { ConnectionsRepository } from "./connections-repository.js";
import type { XHttp } from "./x-client.js";
import { refreshTokens } from "./x-oauth.js";

// Glue over connections-repo + x-oauth: returns a usable X access token for a
// company, transparently refreshing (and persisting) it via OAuth when it has
// expired. The MCP post/reply tools call this to get a token before hitting the
// API. Returns null when the company isn't connected (or can't be refreshed) —
// the caller surfaces "connect X in Settings" rather than failing opaquely.
//
// http + clock are injected (electron-free + testable).

const EXPIRY_BUFFER_MS = 60_000; // refresh a minute early to avoid mid-call expiry

type XPayload = { accessToken?: string; refreshToken?: string; expiresAt?: number };

export const getValidXAccessToken = async (
  repo: ConnectionsRepository,
  http: XHttp,
  companyId: string,
  now: () => number,
): Promise<string | null> => {
  const conn = repo.load(companyId, "x");
  if (conn === null) return null;

  const { accessToken, refreshToken, expiresAt } = conn.payload as XPayload;
  if (
    accessToken !== undefined &&
    expiresAt !== undefined &&
    expiresAt > now() + EXPIRY_BUFFER_MS
  ) {
    return accessToken; // still valid
  }

  const clientId = (conn.metadata as { clientId?: string }).clientId;
  if (refreshToken === undefined || refreshToken === "" || clientId === undefined) {
    return null; // expired and nothing to refresh with → not usable
  }

  return refreshAndPersist(repo, http, companyId, conn.metadata, refreshToken, clientId, now);
};

// Forces a token refresh regardless of the stored expiry, persisting the rotated
// tokens. Used when a write call gets a 401 mid-flight: X rotates/revokes the
// refresh token aggressively, so a token that looks valid by `expiresAt` can be
// rejected by the API. Returns the new access token, or null when there's nothing
// to refresh with (no refresh token / clientId / connection). I8 (audit 2026-06-03).
export const forceRefreshXAccessToken = async (
  repo: ConnectionsRepository,
  http: XHttp,
  companyId: string,
  now: () => number,
): Promise<string | null> => {
  const conn = repo.load(companyId, "x");
  if (conn === null) return null;
  const { refreshToken } = conn.payload as XPayload;
  const clientId = (conn.metadata as { clientId?: string }).clientId;
  if (refreshToken === undefined || refreshToken === "" || clientId === undefined) return null;
  return refreshAndPersist(repo, http, companyId, conn.metadata, refreshToken, clientId, now);
};

const refreshAndPersist = async (
  repo: ConnectionsRepository,
  http: XHttp,
  companyId: string,
  metadata: Record<string, unknown>,
  refreshToken: string,
  clientId: string,
  now: () => number,
): Promise<string> => {
  const fresh = await refreshTokens(http, { clientId, refreshToken }, now);
  // X rotates the refresh token; keep the previous one if the response omitted it.
  const nextRefresh = fresh.refreshToken !== "" ? fresh.refreshToken : refreshToken;
  repo.save(
    companyId,
    "x",
    { accessToken: fresh.accessToken, refreshToken: nextRefresh, expiresAt: fresh.expiresAt },
    metadata,
  );
  return fresh.accessToken;
};
