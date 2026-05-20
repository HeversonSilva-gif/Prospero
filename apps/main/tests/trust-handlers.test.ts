import { describe, it, expect, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trustHandlers } from "../src/ipc/trust-handlers.js";
import { createTrustEventsRepository } from "../src/trust/repository.js";
import { createInboxRepository } from "../src/inbox/repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined },
}));

const applyMigrations = (db: Database.Database) => {
  const migDir = join(__dirname, "../src/db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
};

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    now,
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(now, now);
  db.prepare("UPDATE agents SET trust_tier='confiavel' WHERE id='a1'").run();
  return { db, h: trustHandlers({ db }) };
};

afterEach(() => vi.restoreAllMocks());

describe("trustHandlers", () => {
  it("getHistory returns events in reverse chronological order", () => {
    const { db, h } = setup();
    const repo = createTrustEventsRepository(db);
    repo.create({
      agentId: "a1",
      kind: "promoted",
      fromTier: "novato",
      toTier: "confiavel",
      reason: "first",
    });
    repo.create({
      agentId: "a1",
      kind: "demoted",
      fromTier: "confiavel",
      toTier: "novato",
      reason: "regression",
    });
    const list = h.getHistory({ agentId: "a1" });
    expect(list.length).toBe(2);
    expect(list[0]!.reason).toBe("regression");
  });

  it("approvePromotion flips the agent to autonomo and sets mode=auto", () => {
    const { db, h } = setup();
    const inbox = createInboxRepository(db);
    const item = inbox.create({
      companyId: "c1",
      kind: "trust_promotion_suggested",
      actorId: "a1",
      title: "Promote?",
      preview: null,
      requiresAction: true,
      payloadJson: JSON.stringify({
        agentId: "a1",
        fromTier: "confiavel",
        toTier: "autonomo",
      }),
    });

    const result = h.approvePromotion({ inboxItemId: item.id });

    expect(result.ok).toBe(true);
    const row = db.prepare("SELECT trust_tier, mode FROM agents WHERE id='a1'").get() as {
      trust_tier: string;
      mode: string;
    };
    expect(row.trust_tier).toBe("autonomo");
    expect(row.mode).toBe("auto");
    const card = db.prepare("SELECT read_at FROM inbox_items WHERE id=?").get(item.id) as {
      read_at: number | null;
    };
    expect(card.read_at).not.toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM trust_events").get()).toEqual({ n: 1 });
  });

  it("approvePromotion rejects when the inbox card is wrong kind", () => {
    const { db, h } = setup();
    const inbox = createInboxRepository(db);
    const item = inbox.create({
      companyId: "c1",
      kind: "approval",
      actorId: "a1",
      title: "x",
      preview: null,
      requiresAction: true,
      payloadJson: "{}",
    });
    expect(() => h.approvePromotion({ inboxItemId: item.id })).toThrow(/not a trust/);
  });

  it("approvePromotion throws on missing inbox id", () => {
    const { h } = setup();
    expect(() => h.approvePromotion({ inboxItemId: "nope" })).toThrow(/not found/);
  });

  it("getEvaluation returns the current + eligible tier for an existing agent (M14 PR-D)", () => {
    const { h } = setup();
    // The setup() helper bumps agent a1 to 'confiavel' manually, but no
    // verified outcomes are seeded — eligible drops back to 'novato'.
    const ev = h.getEvaluation({ agentId: "a1" });
    expect(ev.current).toBe("confiavel");
    expect(ev.eligible).toBe("novato");
  });

  it("getEvaluation returns a no-op shape for a missing agent (M14 PR-D)", () => {
    const { h } = setup();
    const ev = h.getEvaluation({ agentId: "missing" });
    expect(ev.current).toBe("novato");
    expect(ev.eligible).toBe("novato");
    expect(ev.blockedReason).toBeNull();
  });
});
