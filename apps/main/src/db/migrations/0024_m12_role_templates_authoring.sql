-- 0024_m12_role_templates_authoring.sql — M12 PR-A
-- role_templates becomes a user-managed library (create/clone/edit/delete).
--   is_seed_example — 1 for the 5 shipped example roles; still deletable, just
--                     flagged in the UI as starting points.
--   created_at / updated_at — lifecycle timestamps for user-managed rows.
-- Existing rows get DEFAULT 0; post-migration 0007 backfills real values.

ALTER TABLE role_templates ADD COLUMN is_seed_example INTEGER NOT NULL DEFAULT 0
  CHECK (is_seed_example IN (0, 1));

ALTER TABLE role_templates ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;

ALTER TABLE role_templates ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
