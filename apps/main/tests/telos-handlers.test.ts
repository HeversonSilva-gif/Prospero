import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../src/db/migrations.js";
import { telosHandlers } from "../src/ipc/telos-handlers.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const userDataDir = mkdtempSync(join(tmpdir(), "telos-handlers-"));
  tmps.push(userDataDir);
  const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
  const h = telosHandlers({
    db,
    userDataDir,
    runDerivation: () =>
      Promise.resolve({
        text: "# Company TELOS\n\n## Mission\n\nx",
        usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      }),
  });
  return { db, h, companyId };
};

describe("telosHandlers", () => {
  it("get returns body null when no TELOS exists", () => {
    const { h, companyId } = setup();
    expect(h.get({ companyId }).body).toBeNull();
  });

  it("save round-trips the body and stamps companies.telos_path", () => {
    const { db, h, companyId } = setup();
    h.save({ companyId, body: "# Company TELOS\n\n## Mission\n\nShip." });
    expect(h.get({ companyId }).body).toBe("# Company TELOS\n\n## Mission\n\nShip.");
    const row = db.prepare("SELECT telos_path FROM companies WHERE id = ?").get(companyId) as {
      telos_path: string | null;
    };
    expect(row.telos_path).toMatch(/telos\.md$/);
  });

  it("synthesize returns a draft from the interview answers", async () => {
    const { h, companyId } = setup();
    const draft = await h.synthesize({
      companyId,
      answers: {
        purpose: "p",
        growth: "g",
        principles: "pr",
        idealState: "i",
        nonGoals: "n",
      },
    });
    expect(draft.telos).toContain("## Mission");
  });
});
