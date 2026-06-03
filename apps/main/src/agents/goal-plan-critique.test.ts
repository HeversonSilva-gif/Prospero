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

  it("also asks whether the issue SET covers the whole goal (I-cov)", () => {
    const p = buildIssueCritiquePrompt("Grow on X", "reach 1k followers", issues);
    expect(p.toLowerCase()).toContain("cover");
    expect(p).toContain("coverageGaps");
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
  it("returns coverage gaps the critic flags (I-cov)", async () => {
    const db = newDb();
    const verdict = JSON.stringify({
      vagueIssues: [],
      coverageGaps: ["No issue collects emails, which the goal requires"],
    });
    const out = await critiqueGoalPlan(
      { db, runDerivation: runner(verdict) },
      {
        goalTitle: "Launch + collect emails",
        goalDescription: "",
        issues,
        env: {},
        companyId: "c1",
      },
    );
    expect(out.coverageGaps).toEqual(["No issue collects emails, which the goal requires"]);
  });
  it("fails open (no vague issues / no coverage gaps) when the verdict is unparseable", async () => {
    const db = newDb();
    const out = await critiqueGoalPlan(
      { db, runDerivation: runner("not json") },
      { goalTitle: "g", goalDescription: "", issues, env: {}, companyId: "c1" },
    );
    expect(out.vagueIssues).toEqual([]);
    expect(out.coverageGaps).toEqual([]);
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
