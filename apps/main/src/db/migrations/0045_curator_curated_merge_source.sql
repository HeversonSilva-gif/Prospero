-- 0045_curator_curated_merge_source.sql — Curator PR-B.
-- Extends the skills.source CHECK constraint to include 'curated_merge'.
-- SQLite does not support ALTER COLUMN, so we recreate the table in-place.

PRAGMA defer_foreign_keys = 1;

CREATE TABLE skills_new (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id        TEXT REFERENCES agents(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  body_path       TEXT NOT NULL,
  description     TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  applies_to_role TEXT,
  source          TEXT NOT NULL
                    CHECK (source IN (
                      'agent_created',
                      'derived_from_issue',
                      'derived_from_recovery',
                      'user_authored',
                      'curated_merge'
                    )),
  trust           REAL NOT NULL DEFAULT 0.5,
  use_count       INTEGER NOT NULL DEFAULT 0,
  last_used       INTEGER,
  promoted        INTEGER NOT NULL DEFAULT 0 CHECK (promoted IN (0,1)),
  created_at      INTEGER NOT NULL,
  soft_deleted    INTEGER NOT NULL DEFAULT 0 CHECK (soft_deleted IN (0,1)),
  soft_deleted_at INTEGER,
  lifecycle_state TEXT NOT NULL DEFAULT 'active',
  view_count      INTEGER NOT NULL DEFAULT 0,
  patch_count     INTEGER NOT NULL DEFAULT 0,
  lifecycle_changed_at INTEGER
);

INSERT INTO skills_new
  (id, company_id, agent_id, name, body_path, description, version,
   applies_to_role, source, trust, use_count, last_used, promoted,
   created_at, soft_deleted, soft_deleted_at, lifecycle_state, view_count,
   patch_count, lifecycle_changed_at)
SELECT
  id, company_id, agent_id, name, body_path, description, version,
  applies_to_role, source, trust, use_count, last_used, promoted,
  created_at, soft_deleted, soft_deleted_at, lifecycle_state, view_count,
  patch_count, lifecycle_changed_at
FROM skills;

DROP TABLE skills;
ALTER TABLE skills_new RENAME TO skills;

CREATE UNIQUE INDEX idx_skills_scope_name
  ON skills(company_id, IFNULL(agent_id,''), name) WHERE soft_deleted = 0;
CREATE INDEX idx_skills_role ON skills(company_id, applies_to_role) WHERE soft_deleted = 0;
