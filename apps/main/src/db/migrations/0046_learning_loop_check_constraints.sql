-- 0046_learning_loop_check_constraints.sql — Hermes rec #2.
-- Add 'verification_failed' to skill_candidates.trigger and
-- 'derived_from_verification' to skills.source. SQLite can't ALTER a CHECK, so
-- both tables are recreated (defer_foreign_keys pattern, mirroring 0045).

PRAGMA defer_foreign_keys = 1;

CREATE TABLE skill_candidates_new (
  id                       TEXT PRIMARY KEY,
  company_id               TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id                 TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_event_id          TEXT NOT NULL REFERENCES activity_events(id),
  trigger                  TEXT NOT NULL CHECK (trigger IN ('issue_done','recovery','verification_failed')),
  proposed_name            TEXT NOT NULL,
  proposed_description     TEXT NOT NULL,
  proposed_body            TEXT NOT NULL,
  proposed_applies_to_role TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','accepted','rejected')),
  reviewed_by              TEXT,
  reviewed_at              INTEGER,
  reject_reason            TEXT,
  created_at               INTEGER NOT NULL
);
INSERT INTO skill_candidates_new
  (id, company_id, agent_id, source_event_id, trigger, proposed_name,
   proposed_description, proposed_body, proposed_applies_to_role, status,
   reviewed_by, reviewed_at, reject_reason, created_at)
SELECT
  id, company_id, agent_id, source_event_id, trigger, proposed_name,
  proposed_description, proposed_body, proposed_applies_to_role, status,
  reviewed_by, reviewed_at, reject_reason, created_at
FROM skill_candidates;
DROP TABLE skill_candidates;
ALTER TABLE skill_candidates_new RENAME TO skill_candidates;
CREATE INDEX idx_skill_candidates_status ON skill_candidates(status, created_at DESC);
CREATE INDEX idx_skill_candidates_source ON skill_candidates(source_event_id);

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
                      'curated_merge',
                      'derived_from_verification'
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
