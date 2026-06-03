import type { ConnectionsRepository } from "./connections-repository.js";
import { postTweet, XApiError, type XHttp, type XPostResult } from "./x-client.js";
import { getValidXAccessToken, forceRefreshXAccessToken } from "./x-token-manager.js";

// The main-process action behind the post_to_x / reply_on_x MCP tools. Gets a valid
// access token for the company (refreshing if expired) and posts. Runs ONLY after
// the agent's outward tool call has been approved via the gate. Throws a clear
// error (surfaced to the agent) when the company hasn't connected X yet.
//
// I8 (audit 2026-06-03 Conectores): a token valid by `expiresAt` can still be
// rejected mid-flight (X rotates/revokes refresh tokens aggressively). On a 401
// from the write, force a token refresh and retry the post exactly once; if that
// also fails (or there's nothing to refresh with), the error surfaces to the caller
// — the event handler turns it into a fail-soft `ok: false` result.
export const executeXPost = async (
  repo: ConnectionsRepository,
  http: XHttp,
  companyId: string,
  text: string,
  opts: { inReplyToId?: string },
  now: () => number,
): Promise<XPostResult> => {
  const token = await getValidXAccessToken(repo, http, companyId, now);
  if (token === null) {
    throw new Error("X não conectado para esta empresa (conecte em Ajustes › Conta).");
  }
  try {
    return await postTweet(http, token, text, opts);
  } catch (e) {
    if (!(e instanceof XApiError) || e.status !== 401) throw e;
    const refreshed = await forceRefreshXAccessToken(repo, http, companyId, now);
    if (refreshed === null) throw e; // nothing to refresh with → surface the 401
    return postTweet(http, refreshed, text, opts); // retry exactly once
  }
};
