-- 0068_stripe_subscriptions.sql — finance panorama (v0.2.8). Persists the company's
-- Stripe subscriptions so the Financeiro screen can show MRR, active customers and
-- churn (a payment digest alone can't express recurring revenue). One row per
-- subscription; `amount`/`currency`/`interval` describe its primary price (smallest
-- currency unit, per interval). `canceled_at` (ms) is set when the subscription ends —
-- churn = subscriptions that canceled within the window. Idempotent via INSERT … ON
-- CONFLICT so a re-poll refreshes status/cancellation.

CREATE TABLE stripe_subscriptions (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id  TEXT,
  status       TEXT NOT NULL,
  product_id   TEXT,
  product_name TEXT,
  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  interval     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  canceled_at  INTEGER,
  recorded_at  INTEGER NOT NULL
);
CREATE INDEX idx_stripe_subscriptions_company ON stripe_subscriptions(company_id, status);
