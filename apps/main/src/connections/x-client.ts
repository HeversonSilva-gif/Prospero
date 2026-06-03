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
) => Promise<{
  status: number;
  json: () => Promise<unknown>;
  // Optional case-insensitive header accessor (matches the fetch Headers API). Used
  // to read Retry-After on a 429; tests/fakes that don't set it just see no back-off.
  headers?: { get: (name: string) => string | null };
}>;

export type XPostResult = { id: string; url: string };

export class XApiError extends Error {
  // On a 429, how long X asked us to wait (Retry-After), in ms — so a poller can
  // back off instead of hammering. Undefined when not rate-limited / not provided.
  retryAfterMs?: number;
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "XApiError";
  }
}

// Reads the Retry-After header (delta-seconds, per RFC 9110) into ms. Returns
// undefined when absent or unparseable — the caller then uses its own default.
const parseRetryAfterMs = (headers?: {
  get: (name: string) => string | null;
}): number | undefined => {
  const raw = headers?.get("retry-after");
  if (raw === null || raw === undefined) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
};

// Builds the error for a non-OK X response, tagging 429s with the Retry-After back-off.
const apiError = (
  status: number,
  message: string,
  headers?: { get: (name: string) => string | null },
): XApiError => {
  const err = new XApiError(status, message);
  // Only set the optional field when we actually have a value (exactOptionalPropertyTypes).
  const retryAfterMs = status === 429 ? parseRetryAfterMs(headers) : undefined;
  if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
  return err;
};

const CREATE_TWEET_URL = "https://api.x.com/2/tweets";
const ME_URL = "https://api.x.com/2/users/me";

// Fetches the authenticated user's id + @handle, for the connection's display
// metadata after OAuth. Throws XApiError on failure (401 → caller refreshes).
export const getMe = async (
  http: XHttp,
  accessToken: string,
): Promise<{ id: string; username: string }> => {
  const res = await http(ME_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new XApiError(401, "X authentication failed");
  const data = (await res.json()) as { data?: { id?: string; username?: string }; detail?: string };
  if (res.status >= 400 || data.data?.id === undefined || data.data.username === undefined) {
    throw new XApiError(res.status, data.detail ?? `X API error ${String(res.status)}`);
  }
  return { id: data.data.id, username: data.data.username };
};

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

export type XUserMetrics = { followers: number; following: number; tweets: number };

export const getUserMetrics = async (http: XHttp, accessToken: string): Promise<XUserMetrics> => {
  const res = await http(`${ME_URL}?user.fields=public_metrics`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new XApiError(401, "X authentication failed");
  const data = (await res.json()) as {
    data?: {
      public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number };
    };
    detail?: string;
  };
  const pm = data.data?.public_metrics;
  if (res.status >= 400 || pm === undefined) {
    throw apiError(res.status, data.detail ?? `X API error ${String(res.status)}`, res.headers);
  }
  return {
    followers: pm.followers_count ?? 0,
    following: pm.following_count ?? 0,
    tweets: pm.tweet_count ?? 0,
  };
};

export type XTweetMetric = {
  id: string;
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
};

const TWEETS_URL = "https://api.x.com/2/tweets";

export const getTweetMetrics = async (
  http: XHttp,
  accessToken: string,
  ids: string[],
): Promise<XTweetMetric[]> => {
  if (ids.length === 0) return [];
  const res = await http(`${TWEETS_URL}?ids=${ids.join(",")}&tweet.fields=public_metrics`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new XApiError(401, "X authentication failed");
  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      public_metrics?: {
        impression_count?: number;
        like_count?: number;
        reply_count?: number;
        retweet_count?: number;
        quote_count?: number;
      };
    }>;
    detail?: string;
  };
  if (res.status >= 400) {
    throw apiError(res.status, data.detail ?? `X API error ${String(res.status)}`, res.headers);
  }
  return (data.data ?? []).map((t) => ({
    id: t.id,
    impressions: t.public_metrics?.impression_count ?? 0,
    likes: t.public_metrics?.like_count ?? 0,
    replies: t.public_metrics?.reply_count ?? 0,
    reposts: t.public_metrics?.retweet_count ?? 0,
    quotes: t.public_metrics?.quote_count ?? 0,
  }));
};
