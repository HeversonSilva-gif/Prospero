import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { buildCritiquePrompt, critiqueCharter } from "./charter-critic.js";
import type { RunDerivationResult } from "../derivation/runner.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

const runner = (text: string) => (): Promise<RunDerivationResult> =>
  Promise.resolve({ text, usage: { input: 10, output: 20, cacheCreation: 0, cacheRead: 0 } });

describe("buildCritiquePrompt", () => {
  it("asks for a JSON verdict and includes the charter + business context", () => {
    const p = buildCritiquePrompt("CHARTER_BODY", "# This business\n\nCompany: BeanBox\n");
    expect(p).toContain("CHARTER_BODY");
    expect(p).toContain("BeanBox");
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain("specific");
  });
});

describe("critiqueCharter", () => {
  it("parses a clean JSON verdict and records a cost event", async () => {
    const db = newDb();
    const verdict = JSON.stringify({
      specific: false,
      depthOk: true,
      genericFlags: ["no product named"],
      feedback: "Name the actual product.",
    });
    const out = await critiqueCharter(
      { db, runDerivation: runner(verdict) },
      { charter: "c", businessContext: "b", env: {}, companyId: "c1" },
    );
    expect(out.specific).toBe(false);
    expect(out.genericFlags).toEqual(["no product named"]);
    const cost = db
      .prepare("SELECT adapter_name FROM cost_events WHERE company_id = 'c1'")
      .get() as { adapter_name: string } | undefined;
    expect(cost?.adapter_name).toBe("charter-critic");
  });

  it("extracts JSON even when the model wraps it in prose", async () => {
    const db = newDb();
    const text =
      'Sure!\n{"specific": true, "depthOk": true, "genericFlags": [], "feedback": ""}\nDone.';
    const out = await critiqueCharter(
      { db, runDerivation: runner(text) },
      { charter: "c", businessContext: "b", env: {}, companyId: "c1" },
    );
    expect(out.specific).toBe(true);
  });

  it("fails open (specific+depthOk true) when the verdict is unparseable", async () => {
    const db = newDb();
    const out = await critiqueCharter(
      { db, runDerivation: runner("not json at all") },
      { charter: "c", businessContext: "b", env: {}, companyId: "c1" },
    );
    expect(out.specific).toBe(true);
    expect(out.depthOk).toBe(true);
  });
});
