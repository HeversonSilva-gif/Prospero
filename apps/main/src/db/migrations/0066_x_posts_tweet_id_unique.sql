-- 0066_x_posts_tweet_id_unique.sql — M4 (audit 2026-06-03 Conectores): make the
-- recorded-tweet log idempotent. x_posts.tweet_id had no UNIQUE constraint, so a
-- replay (or a duplicate event) could record the same tweet twice. Tweet IDs are
-- globally unique on X, so a unique index on tweet_id is the right key.
--
-- Defensive: dedup any pre-existing duplicates first (keep the earliest-inserted
-- row per tweet_id) so the unique index can be created on a real-world DB. New
-- index only — no column added, no CHECK recreate needed.

DELETE FROM x_posts
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM x_posts GROUP BY tweet_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_x_posts_tweet_id ON x_posts(tweet_id);
