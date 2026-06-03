import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { approveBusinessPlan } from "./business-plan-handlers.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Novo negócio',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','CEO','ceo','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',0,0)`,
  ).run();
});

const seed = () => {
  const repo = createBusinessPlansRepository(db);
  const p = repo.insert({
    companyId: "c1",
    proposedByAgentId: "a1",
    concept: "A SaaS recipe assistant.",
    monetization: ["R$9/mo"],
    marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "later" },
    identity: { name: "Cozinha de 15", voice: "friendly", proposedXHandle: "@c15" },
    dropped: [],
  });
  repo.markProposed(p.id);
  return p;
};

const makePlanOption = (
  identity: { name: string; voice: string; proposedXHandle: string },
  overrides: { recommended?: boolean; concept?: string; monetization?: string[] } = {},
) => ({
  concept: overrides.concept ?? "Default concept that is long enough.",
  monetization: overrides.monetization ?? ["R$10/mo"],
  marketing: { initialChannel: "x" as const, tactics: ["threads"], laterChannels: "later" },
  identity,
  dropped: [],
  recommended: overrides.recommended ?? false,
  whyRecommended: "best fit",
  signals: { market: 70, virality: 60, community: 80, revenue12m: "R$ 2–6 mil/mês" },
  projection: { month3: "R$300", month6: "R$600", month12: "R$1200", assumption: "steady growth" },
});

const seedWithOptions = () => {
  const repo = createBusinessPlansRepository(db);
  const options = [
    makePlanOption(
      { name: "Opção Zero", voice: "bold", proposedXHandle: "@op0" },
      { recommended: true, concept: "Option 0 concept.", monetization: ["R$15/mo"] },
    ),
    makePlanOption(
      { name: "Opção Um", voice: "casual", proposedXHandle: "@op1" },
      { concept: "Option 1 concept.", monetization: ["R$20/mo"] },
    ),
    makePlanOption(
      { name: "Opção Dois", voice: "professional", proposedXHandle: "@op2" },
      { concept: "Option 2 concept.", monetization: ["R$25/mo"] },
    ),
  ];
  const recommended = options[0]!;
  const p = repo.insert({
    companyId: "c1",
    proposedByAgentId: "a1",
    concept: recommended.concept,
    monetization: recommended.monetization,
    marketing: recommended.marketing,
    identity: recommended.identity,
    dropped: [],
    options,
  });
  repo.markProposed(p.id);
  return p;
};

const noopDeps = () => ({
  runDerivation: () => Promise.reject(new Error("no telos in test")),
  env: {} as Record<string, string>,
  writeTelos: vi.fn(),
  setTelosPath: vi.fn(),
});

describe("approveBusinessPlan (handler core)", () => {
  it("applies the plan and synthesizes TELOS (fail-soft) when the runner works", async () => {
    const p = seed();
    const writeTelos = vi.fn();
    const res = await approveBusinessPlan(db, "/tmp", p.id, {
      runDerivation: () =>
        Promise.resolve({
          text: "# TELOS\n\n## Purpose\n\nx",
          usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
        }),
      env: {},
      writeTelos,
      setTelosPath: vi.fn(),
    });
    expect(res.ok).toBe(true);
    expect(writeTelos).toHaveBeenCalledOnce();
    expect(createBusinessPlansRepository(db).getById(p.id)?.status).toBe("approved");
  });

  it("still approves when TELOS synthesis throws (fail-soft)", async () => {
    const p = seed();
    const res = await approveBusinessPlan(db, "/tmp", p.id, {
      runDerivation: () => Promise.reject(new Error("boom")),
      env: {},
      writeTelos: vi.fn(),
      setTelosPath: vi.fn(),
    });
    expect(res.ok).toBe(true); // identity + rename still applied
  });

  // P4.2 — 3-options flow
  describe("3-options flow", () => {
    it("approving option 1 (non-recommended) builds company from option 1", async () => {
      const p = seedWithOptions();
      const res = await approveBusinessPlan(db, "/tmp", p.id, noopDeps(), 1);
      expect(res.ok).toBe(true);
      const plan = createBusinessPlansRepository(db).getById(p.id);
      expect(plan?.status).toBe("approved");
      expect(plan?.chosenIndex).toBe(1);
      expect(plan?.identity.name).toBe("Opção Um");
    });

    it("out-of-range chosenIndex returns ok:false", async () => {
      const p = seedWithOptions();
      const res = await approveBusinessPlan(db, "/tmp", p.id, noopDeps(), 99);
      expect(res.ok).toBe(false);
    });

    it("legacy plan (no options) with chosenIndex null still approves", async () => {
      const p = seed();
      const res = await approveBusinessPlan(db, "/tmp", p.id, noopDeps(), null);
      expect(res.ok).toBe(true);
      expect(createBusinessPlansRepository(db).getById(p.id)?.chosenIndex).toBeNull();
    });
  });
});
