import type { ConnectionsRepository } from "./connections-repository.js";
import type { XHttp } from "./x-client.js";
import { executeXPost } from "./x-post-executor.js";

// Payload carried by the `x.post` side-channel event the post_to_x / reply_on_x
// MCP tools emit (in the MCP child) after their tool call passes the approval gate.
export type XPostEventPayload = { postId: string; text: string; inReplyToId?: string };

// Result the tool polls for (keyed by postId) so it can return the tweet URL — or
// a clear error — to the agent in the same turn.
export type XPostEventResult = { ok: true; id: string; url: string } | { ok: false; error: string };

// MAIN-process reaction to an `x.post` event. Only MAIN holds the safeStorage
// cipher to decrypt the company's token, so the actual publish happens here (not
// in the MCP child). Never throws: a failed post writes an `ok: false` result so
// the waiting tool resolves instead of timing out.
export const handleXPostEvent = async (
  deps: {
    repo: ConnectionsRepository;
    http: XHttp;
    writeResult: (postId: string, result: XPostEventResult) => void;
    now: () => number;
    onPosted?: (tweetId: string, text: string) => void;
  },
  companyId: string,
  payload: XPostEventPayload,
): Promise<void> => {
  try {
    const r = await executeXPost(
      deps.repo,
      deps.http,
      companyId,
      payload.text,
      payload.inReplyToId !== undefined ? { inReplyToId: payload.inReplyToId } : {},
      deps.now,
    );
    deps.onPosted?.(r.id, payload.text);
    deps.writeResult(payload.postId, { ok: true, id: r.id, url: r.url });
  } catch (e) {
    deps.writeResult(payload.postId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
