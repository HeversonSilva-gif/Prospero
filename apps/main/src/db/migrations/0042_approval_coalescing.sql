-- 0042_approval_coalescing.sql — v0.1.21 CEO approval coalescing (V2 piece #5)
-- Adds coalesced_with to approvals: NULL for solo or "head" of a batch;
-- non-NULL for followers, pointing at the head approval. Used for audit
-- (which decisions were grouped in the same CEO turn) and for surfacing
-- batched groups in the UI later. Read-only at runtime by the coalescer
-- module; written by approvals/index.ts during routeAndDispatch.

ALTER TABLE approvals ADD COLUMN coalesced_with TEXT REFERENCES approvals(id);

CREATE INDEX IF NOT EXISTS idx_approvals_coalesced_with ON approvals(coalesced_with);
