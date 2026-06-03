import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { toolDefinitions, type ToolContext } from "./tools.js";
import { createCostsRepository } from "../costs/repository.js";
import { createStripePaymentsRepository } from "../connections/stripe-payments-repository.js";

const financeTool = toolDefinitions.find((t) => t.name === "finance_read")!;

describe("finance_read", () => {
  it("returns cost (USD) + revenue per currency from the local tables, no gate", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',0)").run();
    createCostsRepository(db).insert({
      companyId: "c1",
      agentId: null,
      projectId: null,
      issueId: null,
      adapterName: "x",
      model: "opus",
      sessionId: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 250,
      occurredAt: Date.now(),
    });
    createStripePaymentsRepository(db).record({
      id: "ch1",
      companyId: "c1",
      amount: 900,
      currency: "brl",
      createdAt: Date.now(),
      recordedAt: Date.now(),
    });
    const ctx: ToolContext = {
      agentId: "a1",
      companyId: "c1",
      db,
      permissionsDir: mkdtempSync(join(tmpdir(), "fin-")),
      userDataDir: ".",
      emit: vi.fn(),
    };
    const out = JSON.parse(await financeTool.run({ days: 30 }, ctx)) as {
      costUsd: number;
      revenueByCurrency: Record<string, number>;
      revenueCount: number;
    };
    expect(out.costUsd).toBe(2.5);
    expect(out.revenueByCurrency).toEqual({ brl: 900 });
    expect(out.revenueCount).toBe(1);
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it("counts + sums only the window, net of refunds (C3/I5)", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',0)").run();
    const now = Date.now();
    const repo = createStripePaymentsRepository(db);
    // inside window, partially refunded → net 600
    repo.record({
      id: "in",
      companyId: "c1",
      amount: 1000,
      amountRefunded: 400,
      currency: "brl",
      createdAt: now - 1000,
      recordedAt: now,
    });
    // outside a 30-day window → must NOT inflate the count or revenue
    repo.record({
      id: "old",
      companyId: "c1",
      amount: 5000,
      currency: "brl",
      createdAt: now - 60 * 24 * 60 * 60_000,
      recordedAt: now,
    });
    const ctx: ToolContext = {
      agentId: "a1",
      companyId: "c1",
      db,
      permissionsDir: mkdtempSync(join(tmpdir(), "fin-")),
      userDataDir: ".",
      emit: vi.fn(),
    };
    const out = JSON.parse(await financeTool.run({ days: 30 }, ctx)) as {
      revenueByCurrency: Record<string, number>;
      revenueCount: number;
    };
    expect(out.revenueCount).toBe(1); // only the in-window charge (the bug reported 2)
    expect(out.revenueByCurrency).toEqual({ brl: 600 }); // net of the refund
  });
});
