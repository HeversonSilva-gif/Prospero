-- 0049_x_growth.sql — P3 Senses: persist posted tweets (x_posts) + a time-series
-- of X analytics snapshots (x_metrics: account followers + per-tweet engagement).
-- New tables only — no CHECK recreate needed.

CREATE TABLE x_posts (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tweet_id    TEXT NOT NULL,
  text        TEXT NOT NULL,
  posted_at   INTEGER NOT NULL
);
CREATE INDEX idx_x_posts_company ON x_posts(company_id, posted_at);

CREATE TABLE x_metrics (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('account','tweet')),
  subject_id  TEXT,
  followers   INTEGER,
  impressions INTEGER,
  likes       INTEGER,
  replies     INTEGER,
  reposts     INTEGER,
  quotes      INTEGER,
  captured_at INTEGER NOT NULL
);
CREATE INDEX idx_x_metrics_subject ON x_metrics(company_id, kind, subject_id, captured_at);
