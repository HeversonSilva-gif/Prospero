import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { genesisToolDefinitions } from "./tools-genesis.js";

const tool = genesisToolDefinitions.find((t) => t.name === "submit_business_plan")!;

const payload = {
  concept: "Cozinha de 15 — a SaaS recipe assistant for people who work all day.",
  monetization: ["R$9/mo via Stripe"],
  marketing: { initialChannel: "x", tactics: ["5-step recipe threads"], laterChannels: "later" },
  identity: { name: "Cozinha de 15", voice: "friendly", proposedXHandle: "@c15" },
  dropped: [{ idea: "e-book", reason: "needs design" }],
};

let db: Database.Database;
const emitted: { kind: string; payload: unknown }[] = [];
const ctx = () =>
  ({
    db,
    companyId: "c1",
    agentId: "a1",
    emit: (e: { kind: string; payload: unknown }) => emitted.push(e),
  }) as never;

beforeEach(() => {
  emitted.length = 0;
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

describe("submit_business_plan", () => {
  it("stores a critiquing plan and emits business_plan.proposed", async () => {
    const out = JSON.parse(await tool.run({ plan: payload }, ctx())) as { businessPlanId: string };
    const stored = createBusinessPlansRepository(db).getById(out.businessPlanId);
    expect(stored?.status).toBe("critiquing");
    expect(emitted).toEqual([
      { kind: "business_plan.proposed", payload: { businessPlanId: out.businessPlanId } },
    ]);
  });

  it("accepts the plan as a stringified JSON object", async () => {
    const out = JSON.parse(await tool.run({ plan: JSON.stringify(payload) }, ctx())) as {
      businessPlanId: string;
    };
    expect(out.businessPlanId).toMatch(/^bizplan_/);
  });

  it("rejects an invalid payload", async () => {
    await expect(tool.run({ plan: { concept: "too short" } }, ctx())).rejects.toThrow(
      /invalid_business_plan/,
    );
  });
});
