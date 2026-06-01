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
});
