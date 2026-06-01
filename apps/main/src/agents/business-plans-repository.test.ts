import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import {
  createBusinessPlansRepository,
  type BusinessPlanInsert,
} from "./business-plans-repository.js";

const insert: BusinessPlanInsert = {
  companyId: "c1",
  proposedByAgentId: "a1",
  concept: "A SaaS recipe assistant.",
  monetization: ["R$9/mo"],
  marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "later" },
  identity: { name: "Cozinha de 15", voice: "friendly", proposedXHandle: "@c15" },
  dropped: [{ idea: "e-book", reason: "design" }],
};

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','CEO','ceo','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',0,0)`,
  ).run();
});

describe("business-plans-repository", () => {
  it("insert defaults to critiquing and round-trips JSON fields", () => {
    const repo = createBusinessPlansRepository(db);
    const p = repo.insert(insert);
    expect(p.status).toBe("critiquing");
    expect(p.monetization).toEqual(["R$9/mo"]);
    expect(p.identity.proposedXHandle).toBe("@c15");
    expect(p.marketing.initialChannel).toBe("x");
  });

  it("round-trips pricing (null when absent, object when present)", () => {
    const repo = createBusinessPlansRepository(db);
    expect(repo.insert(insert).pricing).toBeNull();
    const pricing = {
      model: "subscription" as const,
      items: [
        {
          name: "Mensal",
          description: "acesso",
          amount: 900,
          currency: "brl",
          interval: "month" as const,
        },
      ],
      rationale: "recorrente",
    };
    const withPricing = repo.insert({ ...insert, pricing });
    expect(repo.getById(withPricing.id)?.pricing).toEqual(pricing);
  });

  it("round-trips ownerProfile (null when absent)", () => {
    const repo = createBusinessPlansRepository(db);
    expect(repo.insert(insert).ownerProfile).toBeNull();
    const p = repo.insert({ ...insert, ownerProfile: "Pragmático, gosta de dados." });
    expect(repo.getById(p.id)?.ownerProfile).toBe("Pragmático, gosta de dados.");
  });

  it("round-trips research (null when absent, object when present)", () => {
    const repo = createBusinessPlansRepository(db);
    expect(repo.insert(insert).research).toBeNull();
    const research = {
      competitors: [{ name: "Yummly", what: "recipe app", price: "free" }],
      differentiation: "15-min meals for busy people.",
    };
    const withResearch = repo.insert({ ...insert, research });
    expect(repo.getById(withResearch.id)?.research).toEqual(research);
  });

  it("getCurrentForCompany hides critiquing, shows proposed", () => {
    const repo = createBusinessPlansRepository(db);
    const p = repo.insert(insert);
    expect(repo.getCurrentForCompany("c1")).toBeNull();
    repo.markProposed(p.id);
    expect(repo.getCurrentForCompany("c1")?.id).toBe(p.id);
  });

  it("supersedeActiveForCompany clears proposed + critiquing", () => {
    const repo = createBusinessPlansRepository(db);
    const a = repo.insert(insert);
    repo.markProposed(a.id);
    repo.supersedeActiveForCompany("c1");
    expect(repo.getCurrentForCompany("c1")).toBeNull();
    expect(repo.getById(a.id)?.status).toBe("superseded");
  });

  it("markApproved / markRejected set status + decidedAt", () => {
    const repo = createBusinessPlansRepository(db);
    const p = repo.insert(insert);
    repo.markApproved(p.id);
    expect(repo.getById(p.id)?.status).toBe("approved");
    expect(repo.getById(p.id)?.decidedAt).not.toBeNull();
    const q = repo.insert(insert);
    repo.markRejected(q.id, "no thanks");
    expect(repo.getById(q.id)?.status).toBe("rejected");
    expect(repo.getById(q.id)?.userFeedback).toBe("no thanks");
  });
});
