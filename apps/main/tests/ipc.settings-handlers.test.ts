import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

import { registerSettingsHandlers } from "../src/ipc/settings-handlers.js";

const setup = () => {
  handlers.clear();
  const db = new Database(":memory:");
  applyMigrations(db);
  registerSettingsHandlers(db);
  return db;
};

describe("settings ipc handlers", () => {
  it("settings:get returns defaults on empty db", async () => {
    setup();
    const get = handlers.get("settings:get");
    expect(get).toBeDefined();
    const result = (await Promise.resolve(get!({}))) as { language: string; theme: string };
    expect(result.language).toBe("pt-BR");
    expect(result.theme).toBe("light");
  });

  it("settings:update writes a partial and returns the new merged state", async () => {
    setup();
    const update = handlers.get("settings:update");
    expect(update).toBeDefined();
    const result = (await Promise.resolve(update!({}, { theme: "dark" }))) as {
      theme: string;
      language: string;
    };
    expect(result.theme).toBe("dark");
    expect(result.language).toBe("pt-BR");
  });
});
