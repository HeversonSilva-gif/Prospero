import type Database from "better-sqlite3";

// P5.3 — store for succeeded Stripe charges the sales poller ingests. `record` is
// idempotent (INSERT OR IGNORE by the Stripe charge id) and returns whether the row
// was NEW, which the collector uses to detect the very first sale exactly once.

export type StripePayment = {
  id: string;
  companyId: string;
  amount: number;
  currency: string;
  createdAt: number;
};

export type StripeSalesTotals = {
  count: number;
  amountByCurrency: Record<string, number>;
};

export type StripePaymentsRepository = {
  /** Idempotent upsert; returns true iff the charge was newly inserted. */
  record(input: {
    id: string;
    companyId: string;
    amount: number;
    currency: string;
    createdAt: number;
    recordedAt: number;
  }): boolean;
  countByCompany(companyId: string): number;
  listByCompany(companyId: string, sinceMs: number): StripePayment[];
  totalsByCompany(companyId: string): StripeSalesTotals;
};

type Row = {
  id: string;
  company_id: string;
  amount: number;
  currency: string;
  created_at: number;
};

export const createStripePaymentsRepository = (db: Database.Database): StripePaymentsRepository => {
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO stripe_payments (id, company_id, amount, currency, created_at, recorded_at)
     VALUES (@id, @companyId, @amount, @currency, @createdAt, @recordedAt)`,
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM stripe_payments WHERE company_id = ?");
  const listStmt = db.prepare(
    `SELECT id, company_id, amount, currency, created_at FROM stripe_payments
     WHERE company_id = ? AND created_at >= ? ORDER BY created_at DESC`,
  );
  const totalsStmt = db.prepare(
    `SELECT currency, COUNT(*) AS n, SUM(amount) AS total FROM stripe_payments
     WHERE company_id = ? GROUP BY currency`,
  );

  return {
    record(input) {
      const info = insertStmt.run(input);
      return info.changes > 0;
    },
    countByCompany(companyId) {
      const r = countStmt.get(companyId) as { n: number };
      return r.n;
    },
    listByCompany(companyId, sinceMs) {
      const rows = listStmt.all(companyId, sinceMs) as Row[];
      return rows.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        amount: r.amount,
        currency: r.currency,
        createdAt: r.created_at,
      }));
    },
    totalsByCompany(companyId) {
      const rows = totalsStmt.all(companyId) as Array<{
        currency: string;
        n: number;
        total: number;
      }>;
      const amountByCurrency: Record<string, number> = {};
      let count = 0;
      for (const r of rows) {
        amountByCurrency[r.currency] = r.total;
        count += r.n;
      }
      return { count, amountByCurrency };
    },
  };
};
