import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { buildIssueCritiquePrompt, critiqueGoalPlan } from "./goal-plan-critique.js";
import type { RunDerivationResult } from "../derivation/runner.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};
const runner = (text: string) => (): Promise<RunDerivationResult> =>
  Promise.resolve({ text, usage: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 } });

const issues = [
  { title: "Set up X", description: "do the thing" },
  { title: "Write launch thread", description: "5-post thread; done when published with a CTA" },
];

describe("buildIssueCritiquePrompt", () => {
  it("includes the goal, each issue, and asks for a JSON verdict", () => {
    const p = buildIssueCritiquePrompt("Grow on X", "reach 1k followers", issues);
    expect(p).toContain("Grow on X");
    expect(p).toContain("Set up X");
    expect(p.toLowerCase()).toContain("json");
    expect(p.toLowerCase()).toContain("vague");
  });
});

describe("critiqueGoalPlan", () => {
  it("returns the issues the critic flags vague", async () => {
    const db = newDb();
    const verdict = JSON.stringify({
      vagueIssues: [{ title: "Set up X", feedback: "Name the concrete deliverable + done-when." }],
    });
    const out = await critiqueGoalPlan(
      { db, runDerivation: runner(verdict) },
      { goalTitle: "Grow on X", goalDescription: "reach 1k", issues, env: {}, companyId: "c1" },
    );
    expect(out.vagueIssues.map((v) => v.title)).toEqual(["Set up X"]);
  });
  it("fails open (no vague issues) when the verdict is unparseable", async () => {
    const db = newDb();
    const out = await critiqueGoalPlan(
      { db, runDerivation: runner("not json") },
      { goalTitle: "g", goalDescription: "", issues, env: {}, companyId: "c1" },
    );
    expect(out.vagueIssues).toEqual([]);
  });
  it("fails open when the runner throws", async () => {
    const db = newDb();
    const out = await critiqueGoalPlan(
      { db, runDerivation: () => Promise.reject(new Error("cli down")) },
      { goalTitle: "g", goalDescription: "", issues, env: {}, companyId: "c1" },
    );
    expect(out.vagueIssues).toEqual([]);
  });
});
