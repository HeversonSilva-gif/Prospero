import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPostMigration0004 } from "../db/post-migrations/0004.js";
import { createCompaniesRepository } from "../companies/repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown): void => {
      handlers.set(ch, fn);
    },
  },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
}));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  runPostMigration0004(db);
  return db;
};

beforeEach(() => handlers.clear());

describe("agents-md handlers", () => {
  it("agents-md:parse returns ok=true on valid input", async () => {
    const db = setupDb();
    const { registerAgentsMdHandlers } = await import("./agents-md-handlers.js");
    registerAgentsMdHandlers(db);
    const parse = handlers.get("agents-md:parse");
    expect(parse).toBeDefined();
    const raw = `---\ncompany: Acme\nagents:\n  - name: A\n    role: engineer\n---\n`;
    const result = (await parse!(null, { raw })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("agents-md:parse returns ok=false on invalid input", async () => {
    const db = setupDb();
    const { registerAgentsMdHandlers } = await import("./agents-md-handlers.js");
    registerAgentsMdHandlers(db);
    const parse = handlers.get("agents-md:parse");
    const result = (await parse!(null, { raw: "no front-matter" })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it("agents-md:hire creates agents into a company", async () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const { registerAgentsMdHandlers } = await import("./agents-md-handlers.js");
    registerAgentsMdHandlers(db);
    const hire = handlers.get("agents-md:hire");
    const result = (await hire!(null, {
      companyId: co.id,
      payload: { company: "Acme", projects: [], agents: [{ name: "A", role: "engineer" }] },
      conflictModes: {},
    })) as { created: { agents: number } };
    expect(result.created.agents).toBe(1);
  });

  it("agents-md:export returns the payload string", async () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const { registerAgentsMdHandlers } = await import("./agents-md-handlers.js");
    registerAgentsMdHandlers(db);
    const exp = handlers.get("agents-md:export");
    const result = (await exp!(null, { companyId: co.id })) as { text: string };
    expect(result.text.startsWith("---")).toBe(true);
    expect(result.text).toMatch(/company: Acme/);
  });
});
