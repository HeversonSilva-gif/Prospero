import { XApiError, type XTweetMetric, type XUserMetrics } from "./x-client.js";
import type { XPost } from "./x-posts-repository.js";

// Default back-off when X 429s without a usable Retry-After header (15 min). The
// poller runs daily, so this only documents intent; the tick simply ends early.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 15 * 60_000;

// Pure per-company analytics collection. All I/O injected so it is unit-testable
// without electron / a live X account. Fail-soft: a company that errors is logged
// and skipped; the rest still run. On a 429 (rate-limit-wide) the whole tick ends
// gracefully rather than hammering the remaining companies (I8, audit 2026-06-03).
export type CollectXMetricsDeps = {
  listCompaniesWithX: () => string[];
  getToken: (companyId: string) => Promise<string | null>;
  getUserMetrics: (token: string) => Promise<XUserMetrics>;
  recentPosts: (companyId: string) => XPost[];
  getTweetMetrics: (token: string, ids: string[]) => Promise<XTweetMetric[]>;
  insertAccount: (input: { companyId: string; followers: number; capturedAt: number }) => void;
  insertTweet: (input: {
    companyId: string;
    tweetId: string;
    impressions: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    capturedAt: number;
  }) => void;
  now: () => number;
  // Optional hook fired once when X rate-limits us; receives the back-off in ms.
  onRateLimited?: (backoffMs: number) => void;
};

export const collectXMetrics = async (deps: CollectXMetricsDeps): Promise<void> => {
  // M5 (audit 2026-06-03 Conectores): listing the companies ran outside the
  // per-company try/catch, so a failure here killed the whole tick. Guard it so the
  // tick is fully fail-soft — an empty list just means "nothing to do this tick".
  let companies: string[];
  try {
    companies = deps.listCompaniesWithX();
  } catch (err) {
    console.warn("[x-metrics] could not list companies with X; skipping tick", err);
    return;
  }
  for (const companyId of companies) {
    try {
      const token = await deps.getToken(companyId);
      if (token === null) continue;
      const capturedAt = deps.now();
      const account = await deps.getUserMetrics(token);
      deps.insertAccount({ companyId, followers: account.followers, capturedAt });
      const ids = deps.recentPosts(companyId).map((p) => p.tweetId);
      if (ids.length > 0) {
        const tweetMetrics = await deps.getTweetMetrics(token, ids);
        for (const m of tweetMetrics) {
          deps.insertTweet({
            companyId,
            tweetId: m.id,
            impressions: m.impressions,
            likes: m.likes,
            replies: m.replies,
            reposts: m.reposts,
            quotes: m.quotes,
            capturedAt,
          });
        }
      }
    } catch (err) {
      // 429 is rate-limit-wide: end the tick gracefully (respecting Retry-After)
      // instead of hammering the remaining companies. The next daily tick retries.
      if (err instanceof XApiError && err.status === 429) {
        const backoffMs = err.retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
        console.warn(`[x-metrics] rate-limited by X; backing off ${String(backoffMs)}ms`);
        deps.onRateLimited?.(backoffMs);
        return;
      }
      console.warn(`[x-metrics] collection failed for company ${companyId}`, err);
    }
  }
};
