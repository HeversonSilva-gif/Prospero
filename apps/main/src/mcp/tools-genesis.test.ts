import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { genesisToolDefinitions } from "./tools-genesis.js";

const tool = genesisToolDefinitions.find((t) => t.name === "submit_business_plan")!;

// A single valid business option (missing recommended/whyRecommended/signals/projection
// — those are added per-test as needed).
const baseOption = {
  concept: "Cozinha de 15 — a SaaS recipe assistant for people who work all day.",
  monetization: ["R$9/mo via Stripe"],
  marketing: { initialChannel: "x", tactics: ["5-step recipe threads"], laterChannels: "later" },
  identity: { name: "Cozinha de 15", voice: "friendly", proposedXHandle: "@c15" },
  dropped: [{ idea: "e-book", reason: "needs design" }],
  recommended: false,
  whyRecommended: "n/a",
  signals: { market: 70, virality: 50, community: 60, revenue12m: "R$2 000–R$5 000/mês" },
  projection: {
    month3: "R$500",
    month6: "R$2 000",
    month12: "R$5 000",
    assumption: "10 paying users at month 3",
  },
};

const option2 = {
  ...baseOption,
  concept: "Finanças Simples — a personal-finance newsletter + SaaS for self-employed Brazilians.",
  identity: { name: "Finanças Simples", voice: "calm", proposedXHandle: "@finsimp" },
};

const option3 = {
  ...baseOption,
  concept:
    "Dev em Dia — a daily newsletter + community for Brazilian junior developers seeking their first job.",
  identity: { name: "Dev em Dia", voice: "motivating", proposedXHandle: "@devemdia" },
  signals: { market: 80, virality: 65, community: 85, revenue12m: "R$3 000–R$8 000/mês" },
};

// Valid 3-option payload: option at index 1 is recommended.
const validOptions = [
  { ...baseOption, recommended: false },
  { ...option2, recommended: true, whyRecommended: "Best fit for the owner's finance background" },
  { ...option3, recommended: false },
];

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

describe("submit_business_plan (3-options)", () => {
  it("stores a critiquing plan and emits business_plan.proposed", async () => {
    const out = JSON.parse(await tool.run({ options: validOptions }, ctx())) as {
      businessPlanId: string;
    };
    const stored = createBusinessPlansRepository(db).getById(out.businessPlanId);
    expect(stored?.status).toBe("critiquing");
    expect(emitted).toEqual([
      { kind: "business_plan.proposed", payload: { businessPlanId: out.businessPlanId } },
    ]);
  });

  it("persists options_json with all 3 options", async () => {
    const out = JSON.parse(await tool.run({ options: validOptions }, ctx())) as {
      businessPlanId: string;
    };
    const stored = createBusinessPlansRepository(db).getById(out.businessPlanId);
    expect(stored?.options).toHaveLength(3);
    expect(stored?.chosenIndex).toBeNull();
  });

  it("mirrors the recommended option into legacy flat columns (backward compat)", async () => {
    const out = JSON.parse(await tool.run({ options: validOptions }, ctx())) as {
      businessPlanId: string;
    };
    const stored = createBusinessPlansRepository(db).getById(out.businessPlanId);
    // option at index 1 (option2) is recommended
    expect(stored?.concept).toBe(option2.concept);
    expect(stored?.identity.name).toBe(option2.identity.name);
  });

  it("accepts options as a stringified JSON array", async () => {
    const out = JSON.parse(await tool.run({ options: JSON.stringify(validOptions) }, ctx())) as {
      businessPlanId: string;
    };
    expect(out.businessPlanId).toMatch(/^bizplan_/);
  });

  it("rejects 0 recommended options (none marked true)", async () => {
    const noRec = validOptions.map((o) => ({ ...o, recommended: false }));
    await expect(tool.run({ options: noRec }, ctx())).rejects.toThrow(/invalid_business_plan/);
  });

  it("rejects 2 recommended options (ambiguous)", async () => {
    const twoRec = validOptions.map((o) => ({ ...o, recommended: true }));
    await expect(tool.run({ options: twoRec }, ctx())).rejects.toThrow(/invalid_business_plan/);
  });

  it("rejects only 1 option (below minimum of 2)", async () => {
    const oneOption = [{ ...baseOption, recommended: true }];
    await expect(tool.run({ options: oneOption }, ctx())).rejects.toThrow(/invalid_business_plan/);
  });

  it("rejects 4 options (above maximum of 3)", async () => {
    const fourOptions = [
      ...validOptions,
      {
        ...baseOption,
        concept: "Extra negócio — a fourth SaaS idea that exceeds the allowed count.",
        recommended: false,
      },
    ];
    await expect(tool.run({ options: fourOptions }, ctx())).rejects.toThrow(
      /invalid_business_plan/,
    );
  });

  it("rejects an option with missing required signals fields", async () => {
    const badOptions = [
      {
        ...baseOption,
        recommended: true,
        signals: { market: 70 } /* missing virality/community/revenue12m */,
      },
      { ...option2, recommended: false },
    ];
    await expect(tool.run({ options: badOptions }, ctx())).rejects.toThrow(/invalid_business_plan/);
  });
});
