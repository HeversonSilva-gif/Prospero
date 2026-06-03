-- 0067_stripe_payments_refunds.sql — Conectores audit I5 (net revenue) + finance
-- dashboard. A succeeded Stripe charge stays "succeeded" after a refund or dispute,
-- so storing the gross amount once (INSERT OR IGNORE, no update path) inflated revenue
-- forever. We now also keep `amount_refunded` (smallest currency unit; a dispute is
-- recorded as a full refund) so net revenue = amount - amount_refunded, and `customer_id`
-- (Stripe charge.customer) so the finance panorama can count paying/repeat customers.

ALTER TABLE stripe_payments ADD COLUMN amount_refunded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stripe_payments ADD COLUMN customer_id TEXT;
