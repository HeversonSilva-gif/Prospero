-- 0043_curator_skill_lifecycle.sql — Curator (Hermes rec #1) PR-A.
-- Adds the skill lifecycle state + the view/patch counters. use_count and
-- last_used already exist (migration 0018). lifecycle_changed_at lets the
-- transition pass fire the "fading"/"archived" inbox notice exactly once.
ALTER TABLE skills ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE skills ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills ADD COLUMN patch_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills ADD COLUMN lifecycle_changed_at INTEGER;
