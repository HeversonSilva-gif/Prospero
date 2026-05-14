import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSettingsRepository } from "../settings/repository.js";
import { getActiveAuthMode } from "./auth-mode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

describe("getActiveAuthMode", () => {
  it("defaults to 'oauth' when no setting persisted", () => {
    const db = setupDb();
    expect(getActiveAuthMode(db)).toBe("oauth");
  });

  it("returns 'api-key' when settings.authMode = 'api-key'", () => {
    const db = setupDb();
    createSettingsRepository(db).write({ authMode: "api-key" });
    expect(getActiveAuthMode(db)).toBe("api-key");
  });

  it("returns 'oauth' when settings.authMode = 'oauth'", () => {
    const db = setupDb();
    createSettingsRepository(db).write({ authMode: "oauth" });
    expect(getActiveAuthMode(db)).toBe("oauth");
  });
});
