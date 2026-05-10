-- 0002_m6_issues_projects.sql — M6 schema deltas (Spec §3.1)

CREATE TABLE IF NOT EXISTS issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('user','agent')),
  sender_id TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_comments_issue
  ON issue_comments(issue_id, created_at);

CREATE TABLE IF NOT EXISTS issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'created','status_changed','assignee_changed','priority_changed','reparented'
  )),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','agent','system')),
  actor_id TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_events_issue
  ON issue_events(issue_id, created_at);
