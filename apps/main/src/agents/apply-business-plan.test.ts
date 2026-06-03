import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createBusinessPlansRepository } from "./business-plans-repository.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { applyBusinessPlan } from "./apply-business-plan.js";

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

const seedProposed = () => {
  const repo = createBusinessPlansRepository(db);
  const p = repo.insert({
    companyId: "c1",
    proposedByAgentId: "a1",
    concept: "A SaaS recipe assistant.",
    monetization: ["R$9/mo"],
    marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "later" },
    identity: { name: "Cozinha de 15", voice: "friendly, short", proposedXHandle: "@c15" },
    dropped: [],
  });
  repo.markProposed(p.id);
  return p;
};

type TestOption = {
  concept: string;
  monetization: string[];
  marketing: { initialChannel: "x"; tactics: string[]; laterChannels: string };
  identity: { name: string; voice: string; proposedXHandle: string };
  dropped: { idea: string; reason: string }[];
  ownerProfile?: string;
  recommended: boolean;
  whyRecommended: string;
  signals: { market: number; virality: number; community: number; revenue12m: string };
  projection: { month3: string; month6: string; month12: string; assumption: string };
};

const makeOption = (
  identity: { name: string; voice: string; proposedXHandle: string },
  overrides: Partial<TestOption> = {},
): TestOption => ({
  concept: "Default concept that is long enough to pass any validation.",
  monetization: ["R$10/mo"],
  marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "later" },
  identity,
  dropped: [],
  recommended: false,
  whyRecommended: "best fit",
  signals: { market: 70, virality: 60, community: 80, revenue12m: "R$ 2–6 mil/mês" },
  projection: { month3: "R$300", month6: "R$600", month12: "R$1200", assumption: "steady growth" },
  ...overrides,
});

const seedProposedWithOptions = () => {
  const repo = createBusinessPlansRepository(db);
  const options: TestOption[] = [
    makeOption(
      { name: "Opção Zero", voice: "bold", proposedXHandle: "@op0" },
      {
        concept: "Option 0 concept — recommended one.",
        recommended: true,
        monetization: ["R$15/mo"],
      },
    ),
    makeOption(
      { name: "Opção Um", voice: "casual", proposedXHandle: "@op1" },
      { concept: "Option 1 concept — second choice.", monetization: ["R$20/mo"] },
    ),
    makeOption(
      { name: "Opção Dois", voice: "professional", proposedXHandle: "@op2" },
      {
        concept: "Option 2 concept — third choice.",
        monetization: ["R$25/mo"],
        ownerProfile: "Empreendedor analítico.",
      },
    ),
  ];
  // Flat columns mirror recommended (index 0)
  const recommended = options[0]!;
  const p = repo.insert({
    companyId: "c1",
    proposedByAgentId: "a1",
    concept: recommended.concept,
    monetization: recommended.monetization,
    marketing: recommended.marketing,
    identity: recommended.identity,
    dropped: recommended.dropped,
    options,
  });
  repo.markProposed(p.id);
  return p;
};

describe("applyBusinessPlan", () => {
  it("approves, renames the company, and persists identity", () => {
    const p = seedProposed();
    const res = applyBusinessPlan(db, p.id);
    expect(res.ok).toBe(true);
    expect(createCompaniesRepository(db).getById("c1")?.name).toBe("Cozinha de 15");
    const row = db
      .prepare("SELECT brand_voice AS v, proposed_x_handle AS h FROM companies WHERE id = 'c1'")
      .get() as { v: string; h: string };
    expect(row.v).toBe("friendly, short");
    expect(row.h).toBe("@c15");
    expect(createBusinessPlansRepository(db).getById(p.id)?.status).toBe("approved");
  });

  it("persists the owner_profile to the company when present", () => {
    const repo = createBusinessPlansRepository(db);
    const p = repo.insert({
      companyId: "c1",
      proposedByAgentId: "a1",
      concept: "A SaaS recipe assistant.",
      monetization: ["R$9/mo"],
      ownerProfile: "Pragmático, valoriza simplicidade.",
      marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "later" },
      identity: { name: "Cozinha de 15", voice: "friendly", proposedXHandle: "@c15" },
      dropped: [],
    });
    repo.markProposed(p.id);
    applyBusinessPlan(db, p.id);
    const row = db.prepare("SELECT owner_profile AS o FROM companies WHERE id = 'c1'").get() as {
      o: string;
    };
    expect(row.o).toBe("Pragmático, valoriza simplicidade.");
  });

  it("returns ok:false for a missing or non-proposed plan", () => {
    expect(applyBusinessPlan(db, "nope").ok).toBe(false);
  });

  // P4.2 — 3-options genesis tests
  describe("3-options flow (chosenIndex)", () => {
    it("approving option 2 builds company from option 2, sets chosen_index=2, flat columns reflect option 2", () => {
      const p = seedProposedWithOptions();
      const res = applyBusinessPlan(db, p.id, 2);
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("unreachable");
      expect(res.brandName).toBe("Opção Dois");

      // Company should be renamed to option 2's identity
      expect(createCompaniesRepository(db).getById("c1")?.name).toBe("Opção Dois");
      const companyRow = db
        .prepare(
          "SELECT brand_voice AS v, proposed_x_handle AS h, owner_profile AS o FROM companies WHERE id = 'c1'",
        )
        .get() as { v: string; h: string; o: string | null };
      expect(companyRow.v).toBe("professional");
      expect(companyRow.h).toBe("@op2");
      expect(companyRow.o).toBe("Empreendedor analítico.");

      // Plan row must reflect option 2 in flat columns
      const planRow = db
        .prepare(
          "SELECT concept, monetization_json, identity_json, chosen_index, status FROM business_plans WHERE id = ?",
        )
        .get(p.id) as {
        concept: string;
        monetization_json: string;
        identity_json: string;
        chosen_index: number;
        status: string;
      };
      expect(planRow.concept).toBe("Option 2 concept — third choice.");
      expect(JSON.parse(planRow.monetization_json)).toEqual(["R$25/mo"]);
      expect((JSON.parse(planRow.identity_json) as { name: string }).name).toBe("Opção Dois");
      expect(planRow.chosen_index).toBe(2);
      expect(planRow.status).toBe("approved");
    });

    it("approving option 0 (the recommended one) also works and sets chosen_index=0", () => {
      const p = seedProposedWithOptions();
      const res = applyBusinessPlan(db, p.id, 0);
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("unreachable");
      expect(res.brandName).toBe("Opção Zero");

      const planRow = db
        .prepare("SELECT chosen_index, status FROM business_plans WHERE id = ?")
        .get(p.id) as { chosen_index: number; status: string };
      expect(planRow.chosen_index).toBe(0);
      expect(planRow.status).toBe("approved");
    });

    it("returns ok:false for an out-of-range chosenIndex", () => {
      const p = seedProposedWithOptions();
      const res = applyBusinessPlan(db, p.id, 5);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("unreachable");
      expect(res.error).toMatch(/out of range/i);
      // Plan must remain proposed (not mutated)
      expect(createBusinessPlansRepository(db).getById(p.id)?.status).toBe("proposed");
    });

    it("legacy single plan (options null) still uses markApproved, chosen_index stays null", () => {
      const p = seedProposed();
      const res = applyBusinessPlan(db, p.id, null);
      expect(res.ok).toBe(true);
      const planRow = db
        .prepare("SELECT chosen_index, status FROM business_plans WHERE id = ?")
        .get(p.id) as { chosen_index: number | null; status: string };
      expect(planRow.chosen_index).toBeNull();
      expect(planRow.status).toBe("approved");
    });

    it("when chosenIndex is non-null but plan has no options, behaves like legacy (applies flat columns, succeeds)", () => {
      // A plan without options_json — chosenIndex is ignored for option mirroring
      // (plan.options === null check in applyBusinessPlan short-circuits mirror step)
      const p = seedProposed();
      const res = applyBusinessPlan(db, p.id, 0);
      expect(res.ok).toBe(true);
      // Company is still renamed from the flat columns
      expect(createCompaniesRepository(db).getById("c1")?.name).toBe("Cozinha de 15");
    });
  });
});
