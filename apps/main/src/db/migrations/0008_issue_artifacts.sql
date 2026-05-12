-- 0008_issue_artifacts.sql — M7.5 PR-B issue work products
-- Records the deliverables produced by agents while closing an issue: file
-- paths, commit SHAs, PR URLs, snapshots, output text. Surfaced in the issue
-- detail modal and used as a soft pre-condition for status=done.

CREATE TABLE IF NOT EXISTS issue_artifacts (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('file_path','commit_sha','pr_url','snapshot','output_text')),
  ref TEXT NOT NULL,
  content_preview TEXT,
  created_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_issue ON issue_artifacts(issue_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON issue_artifacts(kind);
