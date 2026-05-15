-- M11 PR-B: agent memory & learning loop data layer.
-- skills      — procedural knowledge docs (SKILL.md), agent-private or company-shared.
-- memories    — declarative entries (identity/rule/preference/retrospective).
-- skill_candidates — pending auto-derivation suggestions; always human-reviewed.
-- *_fts       — standalone FTS5 virtual tables, kept in sync by the repositories.

CREATE TABLE skills (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id        TEXT REFERENCES agents(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  body_path       TEXT NOT NULL,
  description     TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  applies_to_role TEXT,
  source          TEXT NOT NULL
                    CHECK (source IN ('agent_created','derived_from_issue','derived_from_recovery','user_authored')),
  trust           REAL NOT NULL DEFAULT 0.5,
  use_count       INTEGER NOT NULL DEFAULT 0,
  last_used       INTEGER,
  promoted        INTEGER NOT NULL DEFAULT 0 CHECK (promoted IN (0,1)),
  created_at      INTEGER NOT NULL,
  soft_deleted    INTEGER NOT NULL DEFAULT 0 CHECK (soft_deleted IN (0,1))
);
CREATE UNIQUE INDEX idx_skills_scope_name
  ON skills(company_id, IFNULL(agent_id,''), name) WHERE soft_deleted = 0;
CREATE INDEX idx_skills_role ON skills(company_id, applies_to_role) WHERE soft_deleted = 0;

CREATE TABLE memories (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id        TEXT REFERENCES agents(id) ON DELETE CASCADE,
  applies_to_role TEXT,
  kind            TEXT NOT NULL
                    CHECK (kind IN ('identity','rule','preference','retrospective')),
  body            TEXT NOT NULL,
  importance      REAL NOT NULL DEFAULT 0.5,
  trust           REAL NOT NULL DEFAULT 0.5,
  source_event_id TEXT REFERENCES activity_events(id),
  pinned          INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  created_at      INTEGER NOT NULL,
  last_accessed   INTEGER,
  access_count    INTEGER NOT NULL DEFAULT 0,
  soft_deleted    INTEGER NOT NULL DEFAULT 0 CHECK (soft_deleted IN (0,1))
);
CREATE INDEX idx_memories_agent ON memories(agent_id, soft_deleted, importance DESC);
CREATE INDEX idx_memories_role ON memories(company_id, applies_to_role) WHERE soft_deleted = 0;
CREATE INDEX idx_memories_source ON memories(source_event_id);

CREATE TABLE skill_candidates (
  id                       TEXT PRIMARY KEY,
  company_id               TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id                 TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_event_id          TEXT NOT NULL REFERENCES activity_events(id),
  trigger                  TEXT NOT NULL CHECK (trigger IN ('issue_done','recovery')),
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
CREATE INDEX idx_skill_candidates_status ON skill_candidates(status, created_at DESC);
CREATE INDEX idx_skill_candidates_source ON skill_candidates(source_event_id);

CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, body);
CREATE VIRTUAL TABLE messages_fts USING fts5(message_id UNINDEXED, content);
