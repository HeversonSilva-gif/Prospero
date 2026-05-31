import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { CHARTER_SECTIONS, validateCharter } from "@prospero/shared";
import { applyMigrations } from "../db/migrations.js";
import { buildCritiquePrompt, critiqueCharter, generateCharterDeep } from "./charter-critic.js";
import type { RunDerivationResult } from "../derivation/runner.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

const runner = (text: string) => (): Promise<RunDerivationResult> =>
  Promise.resolve({ text, usage: { input: 10, output: 20, cacheCreation: 0, cacheRead: 0 } });

// Returns derivation results in order — generation and critique calls alternate.
const queueRunner = (texts: string[]) => {
  let i = 0;
  return (): Promise<RunDerivationResult> => {
    const text = texts[Math.min(i++, texts.length - 1)]!;
    return Promise.resolve({
      text,
      usage: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
    });
  };
};

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

  it("fails open when runDerivation throws", async () => {
    const db = newDb();
    const out = await critiqueCharter(
      { db, runDerivation: () => Promise.reject(new Error("claude CLI unavailable")) },
      { charter: "c", businessContext: "b", env: {}, companyId: "c1" },
    );
    expect(out.specific).toBe(true);
    expect(out.depthOk).toBe(true);
    // throw path skips cost recording (no result available)
    expect(db.prepare("SELECT 1 FROM cost_events WHERE company_id='c1'").get()).toBeUndefined();
  });
});

const CHARTER = (tag: string) =>
  `# Role — ${tag}\n\n${CHARTER_SECTIONS.map((s) => `## ${s}\n\nContent ${tag} for ${s}.`).join("\n\n")}\n`;

describe("generateCharterDeep", () => {
  it("returns immediately when the first draft passes", async () => {
    const db = newDb();
    const pass = JSON.stringify({ specific: true, depthOk: true, genericFlags: [], feedback: "" });
    // Calls alternate: generation, then critique. First draft passes → no retry.
    const deps = { db, runDerivation: queueRunner([CHARTER("v1"), pass]) };
    const out = await generateCharterDeep(deps, {
      description: "x",
      businessContext: "b",
      env: {},
      companyId: "c1",
    });
    expect(validateCharter(out.charter).ok).toBe(true);
    expect(out.critique.specific).toBe(true);
  });

  it("regenerates once when the first draft is generic, then stops at the cap", async () => {
    const db = newDb();
    const fail = JSON.stringify({
      specific: false,
      depthOk: true,
      genericFlags: ["generic"],
      feedback: "Name the product.",
    });
    // gen1, critique1(fail), gen2, critique2(fail) → cap reached, returns last
    const deps = {
      db,
      runDerivation: queueRunner([CHARTER("v1"), fail, CHARTER("v2"), fail]),
    };
    const out = await generateCharterDeep(deps, {
      description: "x",
      businessContext: "b",
      env: {},
      companyId: "c1",
    });
    expect(out.charter).toContain("v2"); // used the regenerated draft
    expect(out.critique.specific).toBe(false); // still flagged, but we stop at cap
  });
});
