-- 0039_project_digest.sql — Memória de Contexto de Projeto (Phase 1): digest path.
--
-- Adds projects.digest_path to mark projects whose digest.json has been
-- materialized. The file lives on disk under <userData>/companies/<cid>/projects/<pid>/digest.json
-- and is the source of truth for the digest read-model (mirrors the pattern of
-- goals.isa_path and companies.telos_path). Nullable — projects predate digests.

ALTER TABLE projects ADD COLUMN digest_path TEXT;
