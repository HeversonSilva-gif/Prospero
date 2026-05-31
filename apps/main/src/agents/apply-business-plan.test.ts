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

  it("returns ok:false for a missing or non-proposed plan", () => {
    expect(applyBusinessPlan(db, "nope").ok).toBe(false);
  });
});
