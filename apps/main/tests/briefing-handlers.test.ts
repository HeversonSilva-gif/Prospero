import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { briefingHandlers } from "../src/ipc/briefing-handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));

const applyMigrations = (db: Database.Database) => {
  const migDir = join(__dirname, "../src/db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
};

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,?)").run("c1", "Acme", now);
  const runDerivation = vi.fn().mockResolvedValue({
    text: "Stub headline",
    usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
  });
  return {
    db,
    now,
    h: briefingHandlers({ db, runDerivation, authEnv: () => ({}) }),
  };
};

describe("briefingHandlers", () => {
  it("get returns a stitched Briefing with the AI headline", async () => {
    const { h } = setup();
    const b = await h.get({ companyId: "c1" });
    expect(b.headline).toBe("Stub headline");
    expect(b.needsYou).toEqual([]);
    expect(b.verified).toEqual([]);
  });

  it("markReviewed advances the cursor", async () => {
    const { db, h } = setup();
    await h.markReviewed({ companyId: "c1" });
    const row = db.prepare("SELECT briefing_reviewed_at FROM companies WHERE id = ?").get("c1") as {
      briefing_reviewed_at: number | null;
    };
    expect(row.briefing_reviewed_at).not.toBeNull();
    expect(typeof row.briefing_reviewed_at).toBe("number");
  });

  it("get returns a deterministic fallback when runDerivation throws", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    const runDerivation = vi.fn().mockRejectedValue(new Error("no claude"));
    const h = briefingHandlers({ db, runDerivation, authEnv: () => ({}) });
    const b = await h.get({ companyId: "c1" });
    // Empty counters → "Quiet night." fallback.
    expect(b.headline).toMatch(/quiet night/i);
  });
});
