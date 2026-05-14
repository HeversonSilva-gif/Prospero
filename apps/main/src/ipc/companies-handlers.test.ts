import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompaniesRepository } from "../companies/repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown): void => {
      handlers.set(ch, fn);
    },
  },
}));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

beforeEach(() => {
  handlers.clear();
});

describe("companies handlers", () => {
  it("company:create inserts and returns the new company", async () => {
    const db = setupDb();
    const { registerCompaniesHandlers } = await import("./companies-handlers.js");
    registerCompaniesHandlers(db);
    const handle = handlers.get("company:create");
    expect(handle).toBeDefined();
    const result = (await handle!(null, { name: "Foo" })) as { id: string; name: string };
    expect(result.name).toBe("Foo");
    expect(createCompaniesRepository(db).list()).toHaveLength(1);
  });

  it("company:create rejects empty name", async () => {
    const db = setupDb();
    const { registerCompaniesHandlers } = await import("./companies-handlers.js");
    registerCompaniesHandlers(db);
    const handle = handlers.get("company:create");
    expect(() => handle!(null, { name: "" })).toThrow(/name/);
    expect(() => handle!(null, { name: "   " })).toThrow(/name/);
  });

  it("company:delete removes the row and cascades", async () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const co = repo.create({ name: "ToDel" });
    const { registerCompaniesHandlers } = await import("./companies-handlers.js");
    registerCompaniesHandlers(db);
    const handle = handlers.get("company:delete");
    expect(handle).toBeDefined();
    await handle!(null, { id: co.id });
    expect(repo.getById(co.id)).toBeNull();
  });
});
