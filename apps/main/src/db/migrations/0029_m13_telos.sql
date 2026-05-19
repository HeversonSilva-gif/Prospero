-- M13 PR-C: companies.telos_path — marks a company whose telos.md has been
-- authored. The file itself lives on disk under
-- <userData>/companies/<cid>/telos.md and is the source of truth (mirrors the
-- M13 PR-A goals.isa_path pattern). Nullable — companies predate the TELOS.

ALTER TABLE companies ADD COLUMN telos_path TEXT;
