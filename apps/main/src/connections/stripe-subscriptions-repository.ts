import type Database from "better-sqlite3";

// Store for the company's Stripe subscriptions (finance panorama: MRR / churn / active
// customers). `record` is an idempotent upsert keyed by the Stripe subscription id, so a
// re-poll refreshes status/cancellation without duplicating rows.

export type StripeSubscriptionRow = {
  id: string;
  companyId: string;
  customerId: string | null;
  status: string;
  productId: string | null;
  productName: string | null;
  amount: number;
  currency: string;
  interval: string;
  createdAt: number;
  canceledAt: number | null;
};

export type StripeSubscriptionsRepository = {
  record(input: StripeSubscriptionRow & { recordedAt: number }): void;
  listByCompany(companyId: string): StripeSubscriptionRow[];
};

type Row = {
  id: string;
  company_id: string;
  customer_id: string | null;
  status: string;
  product_id: string | null;
  product_name: string | null;
  amount: number;
  currency: string;
  interval: string;
  created_at: number;
  canceled_at: number | null;
};

export const createStripeSubscriptionsRepository = (
  db: Database.Database,
): StripeSubscriptionsRepository => {
  const upsertStmt = db.prepare(
    `INSERT INTO stripe_subscriptions
       (id, company_id, customer_id, status, product_id, product_name, amount, currency, interval, created_at, canceled_at, recorded_at)
     VALUES (@id, @companyId, @customerId, @status, @productId, @productName, @amount, @currency, @interval, @createdAt, @canceledAt, @recordedAt)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       canceled_at = excluded.canceled_at,
       product_id = excluded.product_id,
       product_name = excluded.product_name,
       amount = excluded.amount,
       currency = excluded.currency,
       interval = excluded.interval,
       customer_id = excluded.customer_id`,
  );
  const listStmt = db.prepare(
    `SELECT id, company_id, customer_id, status, product_id, product_name, amount, currency,
            interval, created_at, canceled_at
     FROM stripe_subscriptions WHERE company_id = ? ORDER BY created_at DESC`,
  );

  return {
    record(input) {
      upsertStmt.run(input);
    },
    listByCompany(companyId) {
      const rows = listStmt.all(companyId) as Row[];
      return rows.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        customerId: r.customer_id,
        status: r.status,
        productId: r.product_id,
        productName: r.product_name,
        amount: r.amount,
        currency: r.currency,
        interval: r.interval,
        createdAt: r.created_at,
        canceledAt: r.canceled_at,
      }));
    },
  };
};
