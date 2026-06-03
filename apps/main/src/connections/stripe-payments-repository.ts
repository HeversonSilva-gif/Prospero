import type Database from "better-sqlite3";

// P5.3 — store for succeeded Stripe charges the sales poller ingests. `record` is
// idempotent (INSERT OR IGNORE by the Stripe charge id) and returns whether the row
// was NEW, which the collector uses to detect the very first sale exactly once.

export type StripePayment = {
  id: string;
  companyId: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  createdAt: number;
  customerId: string | null;
};

export type StripeSalesTotals = {
  count: number;
  /** NET revenue per currency (gross minus refunds/disputes) — I5. */
  amountByCurrency: Record<string, number>;
};

export type StripePaymentsRepository = {
  /**
   * Idempotent upsert; returns true iff the charge was NEWLY inserted. Re-recording a
   * charge that already exists updates its refund/customer (so net revenue tracks later
   * refunds — I5) but returns false (still not a first sale).
   */
  record(input: {
    id: string;
    companyId: string;
    amount: number;
    amountRefunded?: number;
    currency: string;
    createdAt: number;
    recordedAt: number;
    customerId?: string | null;
  }): boolean;
  countByCompany(companyId: string): number;
  listByCompany(companyId: string, sinceMs: number): StripePayment[];
  /** Lifetime net totals. */
  totalsByCompany(companyId: string): StripeSalesTotals;
  /** Net totals + count for charges created at/after sinceMs (C3 windowed read). */
  windowTotals(companyId: string, sinceMs: number): StripeSalesTotals;
  /** Newest charge created_at for this company, or null — the M3 backfill cursor. */
  lastCreatedAt(companyId: string): number | null;
};

type Row = {
  id: string;
  company_id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  created_at: number;
  customer_id: string | null;
};

type TotalsRow = { currency: string; n: number; total: number };

const collectTotals = (rows: TotalsRow[]): StripeSalesTotals => {
  const amountByCurrency: Record<string, number> = {};
  let count = 0;
  for (const r of rows) {
    amountByCurrency[r.currency] = r.total;
    count += r.n;
  }
  return { count, amountByCurrency };
};

export const createStripePaymentsRepository = (db: Database.Database): StripePaymentsRepository => {
  const existsStmt = db.prepare("SELECT 1 FROM stripe_payments WHERE id = ?");
  // Upsert: re-seeing a charge refreshes its refund/customer (net revenue tracks later
  // refunds — I5) without clobbering the original recorded_at.
  const upsertStmt = db.prepare(
    `INSERT INTO stripe_payments
       (id, company_id, amount, amount_refunded, currency, created_at, recorded_at, customer_id)
     VALUES (@id, @companyId, @amount, @amountRefunded, @currency, @createdAt, @recordedAt, @customerId)
     ON CONFLICT(id) DO UPDATE SET
       amount_refunded = excluded.amount_refunded,
       amount = excluded.amount,
       currency = excluded.currency,
       customer_id = excluded.customer_id`,
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM stripe_payments WHERE company_id = ?");
  const listStmt = db.prepare(
    `SELECT id, company_id, amount, amount_refunded, currency, created_at, customer_id
     FROM stripe_payments
     WHERE company_id = ? AND created_at >= ? ORDER BY created_at DESC`,
  );
  // NET = amount - amount_refunded (I5). Per currency.
  const totalsStmt = db.prepare(
    `SELECT currency, COUNT(*) AS n, SUM(amount - amount_refunded) AS total FROM stripe_payments
     WHERE company_id = ? GROUP BY currency`,
  );
  const windowTotalsStmt = db.prepare(
    `SELECT currency, COUNT(*) AS n, SUM(amount - amount_refunded) AS total FROM stripe_payments
     WHERE company_id = ? AND created_at >= ? GROUP BY currency`,
  );
  const lastCreatedStmt = db.prepare(
    "SELECT MAX(created_at) AS m FROM stripe_payments WHERE company_id = ?",
  );

  return {
    record(input) {
      const isNew = existsStmt.get(input.id) === undefined;
      upsertStmt.run({
        ...input,
        amountRefunded: input.amountRefunded ?? 0,
        customerId: input.customerId ?? null,
      });
      return isNew;
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
        amountRefunded: r.amount_refunded,
        currency: r.currency,
        createdAt: r.created_at,
        customerId: r.customer_id,
      }));
    },
    totalsByCompany(companyId) {
      return collectTotals(totalsStmt.all(companyId) as TotalsRow[]);
    },
    windowTotals(companyId, sinceMs) {
      return collectTotals(windowTotalsStmt.all(companyId, sinceMs) as TotalsRow[]);
    },
    lastCreatedAt(companyId) {
      const r = lastCreatedStmt.get(companyId) as { m: number | null };
      return r.m;
    },
  };
};
