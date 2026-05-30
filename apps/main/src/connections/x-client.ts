// Thin, electron-free client for the X (Twitter) v2 API. The HTTP fn is INJECTED so
// the module is unit-testable without a live call and without binding to a specific
// fetch implementation (production passes a wrapper over global fetch).
//
// NOTE: the exact endpoint/contract follows X API v2; confirm against a live account
// in the P1 smoke test — the unit tests assert the request WE send, not that X
// accepts it.

export type XHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export type XPostResult = { id: string; url: string };

export class XApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "XApiError";
  }
}

const CREATE_TWEET_URL = "https://api.x.com/2/tweets";

export const postTweet = async (
  http: XHttp,
  accessToken: string,
  text: string,
  opts: { inReplyToId?: string } = {},
): Promise<XPostResult> => {
  const body: Record<string, unknown> = { text };
  if (opts.inReplyToId !== undefined) {
    body.reply = { in_reply_to_tweet_id: opts.inReplyToId };
  }
  const res = await http(CREATE_TWEET_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // 401 is special: the caller refreshes the OAuth token and retries once.
  if (res.status === 401) throw new XApiError(401, "X authentication failed");
  const data = (await res.json()) as { data?: { id?: string }; detail?: string; title?: string };
  const id = data.data?.id;
  if (res.status >= 400 || id === undefined) {
    throw new XApiError(
      res.status,
      data.detail ?? data.title ?? `X API error ${String(res.status)}`,
    );
  }
  return { id, url: `https://x.com/i/status/${id}` };
};
