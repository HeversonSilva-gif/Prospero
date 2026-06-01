-- 0053_stripe_payments.sql — P5.3. Persists succeeded Stripe charges the sales
-- poller ingests, so "first sale" is detected once (and survives restart) and the
-- stripe_sales_read tool has a local digest to read. `id` is the Stripe charge id
-- (idempotency: re-seeing a charge is a no-op via INSERT OR IGNORE). amount is the
-- smallest currency unit; created_at is the charge's creation time in ms.

CREATE TABLE stripe_payments (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  currency    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX idx_stripe_payments_company ON stripe_payments(company_id, created_at);
