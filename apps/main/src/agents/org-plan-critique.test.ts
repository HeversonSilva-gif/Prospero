import { describe, it, expect } from "vitest";
import type { RunDerivationResult } from "../derivation/runner.js";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { decideOrgPlanOutcome, critiqueOrgPlan } from "./org-plan-critique.js";
import type { ProposedRole } from "@prospero/shared";

describe("decideOrgPlanOutcome", () => {
  it("revises when there are generic charters and revision budget remains", () => {
    expect(decideOrgPlanOutcome({ genericCount: 2, attempts: 0, cap: 1 })).toBe("revise");
  });
  it("shows the card when the revision cap is reached even if still generic", () => {
    expect(decideOrgPlanOutcome({ genericCount: 2, attempts: 1, cap: 1 })).toBe("card");
  });
  it("shows the card when nothing is generic", () => {
    expect(decideOrgPlanOutcome({ genericCount: 0, attempts: 0, cap: 1 })).toBe("card");
  });
});

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

const role = (name: string): ProposedRole => ({
  index: 0,
  name,
  description: "d",
  charter: `# ${name}`,
  model: "claude-sonnet-4-6",
  capabilities: [],
  icon: null,
});

// Returns a verdict keyed by which charter is being judged (the prompt embeds the
// charter, so we can branch on its content).
const verdictRunner =
  (genericNames: string[]) =>
  (input: { prompt: string }): Promise<RunDerivationResult> => {
    const isGeneric = genericNames.some((n) => input.prompt.includes(`# ${n}`));
    const verdict = JSON.stringify({
      specific: !isGeneric,
      depthOk: !isGeneric,
      genericFlags: isGeneric ? ["generic"] : [],
      feedback: isGeneric ? "Name the product." : "",
    });
    return Promise.resolve({
      text: verdict,
      usage: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
    });
  };

describe("critiqueOrgPlan", () => {
  it("collects only the roles whose charter reads generic", async () => {
    const db = newDb();
    const { genericRoles } = await critiqueOrgPlan(
      { db, runDerivation: verdictRunner(["Engineer"]) },
      {
        roles: [role("Engineer"), role("X Growth Lead")],
        businessContext: "b",
        env: {},
        companyId: "c1",
      },
    );
    expect(genericRoles.map((r) => r.name)).toEqual(["Engineer"]);
    expect(genericRoles[0]?.feedback).toBe("Name the product.");
  });

  it("returns no generic roles when every charter passes", async () => {
    const db = newDb();
    const { genericRoles } = await critiqueOrgPlan(
      { db, runDerivation: verdictRunner([]) },
      { roles: [role("A"), role("B")], businessContext: "b", env: {}, companyId: "c1" },
    );
    expect(genericRoles).toEqual([]);
  });
});
