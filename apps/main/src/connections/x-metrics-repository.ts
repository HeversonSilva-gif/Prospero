import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type AccountSnapshot = { followers: number; capturedAt: number };
export type TweetSnapshot = {
  tweetId: string;
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  capturedAt: number;
};

export type XMetricsRepository = {
  insertAccount: (input: { companyId: string; followers: number; capturedAt: number }) => void;
  insertTweet: (input: { companyId: string } & TweetSnapshot) => void;
  latestAccount: (companyId: string) => AccountSnapshot | null;
  tweetSeries: (companyId: string, tweetId: string, sinceMs: number) => TweetSnapshot[];
};

export const createXMetricsRepository = (db: Database.Database): XMetricsRepository => {
  const insAccount = db.prepare(
    `INSERT INTO x_metrics (id, company_id, kind, subject_id, followers, captured_at)
     VALUES (?, ?, 'account', NULL, ?, ?)`,
  );
  const insTweet = db.prepare(
    `INSERT INTO x_metrics (id, company_id, kind, subject_id, impressions, likes, replies, reposts, quotes, captured_at)
     VALUES (?, ?, 'tweet', ?, ?, ?, ?, ?, ?, ?)`,
  );
  const latestAccountStmt = db.prepare(
    `SELECT followers, captured_at FROM x_metrics
     WHERE company_id = ? AND kind = 'account' ORDER BY captured_at DESC LIMIT 1`,
  );
  const tweetSeriesStmt = db.prepare(
    `SELECT subject_id, impressions, likes, replies, reposts, quotes, captured_at FROM x_metrics
     WHERE company_id = ? AND kind = 'tweet' AND subject_id = ? AND captured_at >= ?
     ORDER BY captured_at ASC`,
  );
  return {
    insertAccount(input) {
      insAccount.run(`xm_${randomUUID()}`, input.companyId, input.followers, input.capturedAt);
    },
    insertTweet(input) {
      insTweet.run(
        `xm_${randomUUID()}`,
        input.companyId,
        input.tweetId,
        input.impressions,
        input.likes,
        input.replies,
        input.reposts,
        input.quotes,
        input.capturedAt,
      );
    },
    latestAccount(companyId) {
      const r = latestAccountStmt.get(companyId) as
        | { followers: number; captured_at: number }
        | undefined;
      return r ? { followers: r.followers, capturedAt: r.captured_at } : null;
    },
    tweetSeries(companyId, tweetId, sinceMs) {
      const rows = tweetSeriesStmt.all(companyId, tweetId, sinceMs) as Array<{
        subject_id: string;
        impressions: number;
        likes: number;
        replies: number;
        reposts: number;
        quotes: number;
        captured_at: number;
      }>;
      return rows.map((r) => ({
        tweetId: r.subject_id,
        impressions: r.impressions,
        likes: r.likes,
        replies: r.replies,
        reposts: r.reposts,
        quotes: r.quotes,
        capturedAt: r.captured_at,
      }));
    },
  };
};
