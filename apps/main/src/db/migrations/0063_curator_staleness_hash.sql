-- 0063_curator_staleness_hash.sql — Curator T2.6 hardening.
--
-- skill_proposals gains source_versions_json: a JSON object mapping source skill
-- id → skill.version at the time the proposal was created. Used by apply-proposal
-- to detect staleness: if the source skill's version has advanced since the
-- proposal snapshot, a patch is refused rather than clobbering newer edits.
-- Nullable so existing rows (no snapshot) apply without restriction.

ALTER TABLE skill_proposals ADD COLUMN source_versions_json TEXT;
