import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createStripePaymentsRepository } from "./stripe-payments-repository.js";
import { createStripeSubscriptionsRepository } from "./stripe-subscriptions-repository.js";
import { createCostsRepository } from "../costs/repository.js";
import { computeFinanceSummary } from "./finance-summary.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15
const WINDOW = 30 * DAY;

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
});

const pay = (over: Record<string, unknown>) =>
  createStripePaymentsRepository(db).record({
    id: "p",
    companyId: "c1",
    amount: 0,
    amountRefunded: 0,
    currency: "brl",
    createdAt: NOW,
    recordedAt: NOW,
    customerId: null,
    ...over,
  });

const subRec = (over: Record<string, unknown>) =>
  createStripeSubscriptionsRepository(db).record({
    id: "s",
    companyId: "c1",
    customerId: null,
    status: "active",
    productId: "prod",
    productName: "Plano",
    amount: 0,
    currency: "brl",
    interval: "month",
    createdAt: NOW,
    canceledAt: null,
    recordedAt: NOW,
    ...over,
  });

const cost = (cents: number, occurredAt: number) =>
  createCostsRepository(db).insert({
    companyId: "c1",
    agentId: null,
    projectId: null,
    issueId: null,
    adapterName: "claude",
    model: "claude-opus-4-8",
    sessionId: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costCentsEstimate: cents,
    occurredAt,
  });

describe("computeFinanceSummary", () => {
  it("crosses payments + subscriptions + cost into a panorama", () => {
    pay({ id: "p1", amount: 1000, currency: "brl", customerId: "cus_1", createdAt: NOW - 5 * DAY });
    pay({
      id: "p2",
      amount: 1000,
      amountRefunded: 400,
      currency: "brl",
      customerId: "cus_1",
      createdAt: NOW - 3 * DAY,
    });
    pay({ id: "p3", amount: 500, currency: "brl", customerId: "cus_2", createdAt: NOW - 60 * DAY });
    pay({ id: "p4", amount: 100, currency: "usd", customerId: "cus_3", createdAt: NOW - 2 * DAY });

    subRec({
      id: "s1",
      status: "active",
      amount: 1000,
      interval: "month",
      productName: "Plano A",
      customerId: "cus_1",
      createdAt: NOW - 10 * DAY,
    });
    subRec({
      id: "s2",
      status: "active",
      amount: 12000,
      interval: "year",
      productName: "Plano B",
      customerId: "cus_4",
      createdAt: NOW - 200 * DAY,
    });
    subRec({
      id: "s3",
      status: "canceled",
      amount: 1000,
      interval: "month",
      productName: "Plano A",
      customerId: "cus_5",
      createdAt: NOW - 100 * DAY,
      canceledAt: NOW - 5 * DAY,
    });

    cost(250, NOW - 5 * DAY);
    cost(999, NOW - 60 * DAY); // outside window

    const s = computeFinanceSummary(db, "c1", { now: NOW, windowMs: WINDOW });

    expect(s.currency).toBe("brl");
    expect(s.lifetimeRevenueCents).toBe(2100); // 1000 + 600 + 500
    expect(s.windowRevenueCents).toBe(1600); // p1 + p2(net)
    expect(s.revenueByCurrency).toEqual({ brl: 2100, usd: 100 });
    expect(s.mrrCents).toBe(2000); // 1000 (month) + 1000 (12000/12)
    expect(s.activeSubscriptions).toBe(2);
    expect(s.activeCustomers).toBe(3); // cus_1 (sub+pay), cus_4 (sub), cus_3 (window pay)
    expect(s.newCustomers).toBe(2); // cus_1 (first seen -10d), cus_3 (-2d)
    expect(s.churnRatePct).toBe(50); // 1 canceled / 2 active-at-start
    expect(s.repeatPurchaseRatePct).toBeNull();
    expect(s.topProducts).toHaveLength(2);
    expect(s.topProducts.reduce((a, p) => a + p.mrrCents, 0)).toBe(2000);
    expect(s.costCents).toBe(250);
    expect(s.windowDays).toBe(30);
    expect(s.hasStripe).toBe(true);

    expect(s.revenueByMonth).toHaveLength(12);
    expect(s.revenueByMonth.find((m) => m.month === "2026-06")?.revenueCents).toBe(1600);
    expect(s.revenueByMonth.find((m) => m.month === "2026-04")?.revenueCents).toBe(500);
  });

  it("falls back to repeat-purchase rate when there are no subscriptions", () => {
    pay({ id: "a", amount: 500, customerId: "cus_1", createdAt: NOW - 1 * DAY });
    pay({ id: "b", amount: 500, customerId: "cus_1", createdAt: NOW - 2 * DAY });
    pay({ id: "c", amount: 500, customerId: "cus_2", createdAt: NOW - 2 * DAY });
    const s = computeFinanceSummary(db, "c1", { now: NOW, windowMs: WINDOW });
    expect(s.churnRatePct).toBeNull();
    expect(s.repeatPurchaseRatePct).toBe(50); // cus_1 repeats out of 2 payers
    expect(s.mrrCents).toBe(0);
  });

  it("is empty-safe with no Stripe data", () => {
    const s = computeFinanceSummary(db, "c1", { now: NOW, windowMs: WINDOW });
    expect(s.hasStripe).toBe(false);
    expect(s.currency).toBe("brl");
    expect(s.lifetimeRevenueCents).toBe(0);
    expect(s.mrrCents).toBe(0);
    expect(s.churnRatePct).toBeNull();
    expect(s.repeatPurchaseRatePct).toBeNull();
    expect(s.topProducts).toEqual([]);
    expect(s.revenueByMonth).toHaveLength(12);
  });
});
