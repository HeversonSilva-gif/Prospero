import type { ConnectionsRepository } from "./connections-repository.js";
import { postTweet, type XHttp, type XPostResult } from "./x-client.js";
import { getValidXAccessToken } from "./x-token-manager.js";

// The main-process action behind the post_to_x / reply_on_x MCP tools. Gets a valid
// access token for the company (refreshing if expired) and posts. Runs ONLY after
// the agent's outward tool call has been approved via the gate. Throws a clear
// error (surfaced to the agent) when the company hasn't connected X yet.
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
  return postTweet(http, token, text, opts);
};
