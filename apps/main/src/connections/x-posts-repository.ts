import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type XPost = { tweetId: string; text: string; postedAt: number };

export type XPostsRepository = {
  record: (input: { companyId: string; tweetId: string; text: string; postedAt: number }) => void;
  recentByCompany: (companyId: string, sinceMs: number) => XPost[];
};

export const createXPostsRepository = (db: Database.Database): XPostsRepository => {
  const insertStmt = db.prepare(
    `INSERT INTO x_posts (id, company_id, tweet_id, text, posted_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const recentStmt = db.prepare(
    `SELECT tweet_id, text, posted_at FROM x_posts
     WHERE company_id = ? AND posted_at >= ? ORDER BY posted_at DESC`,
  );
  return {
    record(input) {
      insertStmt.run(
        `xp_${randomUUID()}`,
        input.companyId,
        input.tweetId,
        input.text,
        input.postedAt,
      );
    },
    recentByCompany(companyId, sinceMs) {
      const rows = recentStmt.all(companyId, sinceMs) as Array<{
        tweet_id: string;
        text: string;
        posted_at: number;
      }>;
      return rows.map((r) => ({ tweetId: r.tweet_id, text: r.text, postedAt: r.posted_at }));
    },
  };
};
