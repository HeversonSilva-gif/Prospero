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
});
