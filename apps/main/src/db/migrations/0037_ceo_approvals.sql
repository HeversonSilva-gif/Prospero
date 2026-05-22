-- M-CEO-approvals: route approval requests to the CEO agent (or escalate to human).
-- approvals.kind is a free TEXT column (no CHECK constraint) so "manager_request"
-- needs no schema change. We add routing + escalation bookkeeping columns.
ALTER TABLE approvals ADD COLUMN routed_to TEXT;      -- 'ceo' | 'user' | NULL (legacy)
ALTER TABLE approvals ADD COLUMN escalated_at INTEGER; -- ms epoch | NULL

CREATE INDEX IF NOT EXISTS idx_approvals_pending_ceo
  ON approvals (status, routed_to) WHERE status = 'pending';
