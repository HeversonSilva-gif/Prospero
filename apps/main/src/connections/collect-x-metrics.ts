import type { XTweetMetric, XUserMetrics } from "./x-client.js";
import type { XPost } from "./x-posts-repository.js";

// Pure per-company analytics collection. All I/O injected so it is unit-testable
// without electron / a live X account. Fail-soft: a company that errors is logged
// and skipped; the rest still run.
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
};

export const collectXMetrics = async (deps: CollectXMetricsDeps): Promise<void> => {
  for (const companyId of deps.listCompaniesWithX()) {
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
      console.warn(`[x-metrics] collection failed for company ${companyId}`, err);
    }
  }
};
