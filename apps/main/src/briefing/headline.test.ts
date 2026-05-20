import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBriefingHeadline } from "./headline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setup = () => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,?)").run(
    "c1",
    "Acme",
    Date.now(),
  );
  return db;
};

const counters = {
  verified: 3,
  failed: 1,
  needsYou: 2,
  learned: 0,
  inProgress: 4,
  costCents: 50,
};

describe("generateBriefingHeadline", () => {
  it("calls runDerivation on first request and writes to the cache", async () => {
    const db = setup();
    const runDerivation = vi.fn().mockResolvedValue({
      text: "Three outcomes shipped overnight; two need a look.",
      usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
    });
    const text = await generateBriefingHeadline(
      { db, runDerivation },
      { companyId: "c1", counters, env: {} },
    );
    expect(text).toMatch(/three outcomes/i);
    expect(runDerivation).toHaveBeenCalledTimes(1);
    const row = db
      .prepare("SELECT briefing_headline_json AS json FROM companies WHERE id = ?")
      .get("c1") as { json: string | null };
    expect(row.json).not.toBeNull();
    const parsed = JSON.parse(row.json!) as { hash: string; text: string };
    expect(parsed.text).toContain("Three outcomes");
  });

  it("reuses the cache when the hash matches", async () => {
    const db = setup();
    const runDerivation = vi.fn().mockResolvedValue({
      text: "Headline-A",
      usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
    });
    await generateBriefingHeadline({ db, runDerivation }, { companyId: "c1", counters, env: {} });
    const text2 = await generateBriefingHeadline(
      { db, runDerivation },
      { companyId: "c1", counters, env: {} },
    );
    expect(text2).toBe("Headline-A");
    expect(runDerivation).toHaveBeenCalledTimes(1);
  });

  it("regenerates when counters change", async () => {
    const db = setup();
    const runDerivation = vi
      .fn()
      .mockResolvedValueOnce({
        text: "Headline-A",
        usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
      })
      .mockResolvedValueOnce({
        text: "Headline-B",
        usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
      });
    await generateBriefingHeadline({ db, runDerivation }, { companyId: "c1", counters, env: {} });
    const text2 = await generateBriefingHeadline(
      { db, runDerivation },
      { companyId: "c1", counters: { ...counters, verified: 99 }, env: {} },
    );
    expect(text2).toBe("Headline-B");
    expect(runDerivation).toHaveBeenCalledTimes(2);
  });

  it("falls back to a deterministic string when runDerivation throws", async () => {
    const db = setup();
    const runDerivation = vi.fn().mockRejectedValue(new Error("no claude CLI"));
    const text = await generateBriefingHeadline(
      { db, runDerivation },
      { companyId: "c1", counters, env: {} },
    );
    expect(text).toMatch(/3.*delivered.*2.*need/i);
    // Cache should NOT be written on failure (so the next call retries).
    const row = db
      .prepare("SELECT briefing_headline_json AS json FROM companies WHERE id = ?")
      .get("c1") as { json: string | null };
    expect(row.json).toBeNull();
  });

  it("records a cost_events row on a successful call", async () => {
    const db = setup();
    const runDerivation = vi.fn().mockResolvedValue({
      text: "Headline",
      usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
    });
    await generateBriefingHeadline({ db, runDerivation }, { companyId: "c1", counters, env: {} });
    const row = db
      .prepare("SELECT adapter_name FROM cost_events WHERE company_id = ?")
      .get("c1") as { adapter_name: string };
    expect(row.adapter_name).toBe("briefing-headline");
  });
});
