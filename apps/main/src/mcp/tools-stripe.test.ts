import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { toolDefinitions, type ToolContext } from "./tools.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { createStripePaymentsRepository } from "../connections/stripe-payments-repository.js";

const setupTool = toolDefinitions.find((t) => t.name === "setup_monetization")!;
const linkTool = toolDefinitions.find((t) => t.name === "create_payment_link")!;
const salesTool = toolDefinitions.find((t) => t.name === "stripe_sales_read")!;

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',?)").run(Date.now());
  db.prepare(
    `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
     VALUES ('bot1','c1','Bot','engineer','','["connectors"]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(Date.now(), Date.now());
  const dir = mkdtempSync(join(tmpdir(), "perm-stripe-"));
  return { db, dir };
}

const waitForReq = async (dir: string): Promise<{ tool_use_id: string; tool_name: string }> => {
  for (let i = 0; i < 100; i++) {
    const f = readdirSync(dir).find((n) => n.endsWith(".req.json"));
    if (f !== undefined)
      return JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        tool_use_id: string;
        tool_name: string;
      };
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no .req.json appeared");
};

const ctxFor = (
  db: Database.Database,
  dir: string,
  emit: (ev: { kind: string; payload: unknown }) => void,
): ToolContext => ({
  agentId: "bot1",
  companyId: "c1",
  db,
  permissionsDir: dir,
  userDataDir: dir,
  emit,
});

const seedApprovedPricing = (db: Database.Database): void => {
  const repo = createBusinessPlansRepository(db);
  const p = repo.insert({
    companyId: "c1",
    proposedByAgentId: "bot1",
    concept: "c",
    monetization: ["R$9/mo"],
    pricing: {
      model: "subscription",
      items: [
        { name: "Mensal", description: "acesso", amount: 900, currency: "brl", interval: "month" },
      ],
      rationale: "recorrente",
    },
    marketing: { initialChannel: "x", tactics: ["t"], laterChannels: "" },
    identity: { name: "N", voice: "v", proposedXHandle: "@n" },
    dropped: [],
  });
  repo.markApproved(p.id);
};

describe("setup_monetization", () => {
  it("errors clearly when there is no approved pricing (no gate, no emit)", async () => {
    const { db, dir } = setup();
    const emit = vi.fn();
    const out = JSON.parse(await setupTool.run({}, ctxFor(db, dir, emit))) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it("gates, then emits stripe.setup with the approved items and returns MAIN's result", async () => {
    const { db, dir } = setup();
    seedApprovedPricing(db);
    const emit = vi.fn((ev: { kind: string; payload: unknown }) => {
      if (ev.kind === "stripe.setup") {
        const { requestId } = ev.payload as { requestId: string };
        writeFileSync(
          join(dir, `${requestId}.stripe.json`),
          JSON.stringify({ ok: true, url: "https://buy.stripe.com/x", paymentLinkId: "plink" }),
        );
      }
    });
    const runPromise = setupTool.run({}, ctxFor(db, dir, emit));
    const req = await waitForReq(dir);
    expect(req.tool_name).toBe("setup_monetization");
    writeFileSync(join(dir, `${req.tool_use_id}.res.json`), JSON.stringify({ behavior: "allow" }));
    const out = JSON.parse(await runPromise) as { ok: boolean; url: string };
    expect(out).toEqual({ ok: true, url: "https://buy.stripe.com/x", paymentLinkId: "plink" });
    expect(emit).toHaveBeenCalledWith({
      kind: "stripe.setup",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({ items: expect.any(Array) }),
    });
  });
});

describe("create_payment_link", () => {
  it("does NOT create when the gate rejects the tool call", async () => {
    const { db, dir } = setup();
    const emit = vi.fn();
    const runPromise = linkTool.run(
      { name: "Ebook", amount: 1990, currency: "brl" },
      ctxFor(db, dir, emit),
    );
    const req = await waitForReq(dir);
    expect(req.tool_name).toBe("create_payment_link");
    writeFileSync(
      join(dir, `${req.tool_use_id}.deny.json`),
      JSON.stringify({ behavior: "deny", message: "nope" }),
    );
    const out = JSON.parse(await runPromise) as { ok: boolean; status: string };
    expect(out.ok).toBe(false);
    expect(out.status).toBe("deny");
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("stripe_sales_read", () => {
  it("returns a digest of totals + recent payments from the local store (no gate)", async () => {
    const { db, dir } = setup();
    const repo = createStripePaymentsRepository(db);
    repo.record({
      id: "ch_1",
      companyId: "c1",
      amount: 900,
      currency: "brl",
      createdAt: Date.now() - 1000,
      recordedAt: Date.now(),
    });
    const emit = vi.fn();
    const out = JSON.parse(await salesTool.run({}, ctxFor(db, dir, emit))) as {
      totalPayments: number;
      totalByCurrency: Record<string, number>;
      recent: Array<{ amount: number }>;
    };
    expect(out.totalPayments).toBe(1);
    expect(out.totalByCurrency).toEqual({ brl: 900 });
    expect(out.recent[0]?.amount).toBe(900);
    expect(emit).not.toHaveBeenCalled();
  });
});
