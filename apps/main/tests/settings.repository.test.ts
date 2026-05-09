import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createSettingsRepository } from "../src/settings/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return { db, repo: createSettingsRepository(db) };
};

describe("settings repository", () => {
  it("returns defaults on empty db", () => {
    const { repo } = setup();
    expect(repo.read()).toEqual({ language: "pt-BR", theme: "light" });
  });

  it("persists a single field via write()", () => {
    const { repo } = setup();
    repo.write({ theme: "dark" });
    expect(repo.read()).toEqual({ language: "pt-BR", theme: "dark" });
  });

  it("persists multiple fields", () => {
    const { repo } = setup();
    repo.write({ language: "en-US", theme: "dark" });
    expect(repo.read()).toEqual({ language: "en-US", theme: "dark" });
  });

  it("ignores invalid values silently", () => {
    const { repo } = setup();
    repo.write({ theme: "neon" } as never);
    expect(repo.read().theme).toBe("light");
  });

  it("reads survive across re-instantiations on the same db", () => {
    const { db, repo } = setup();
    repo.write({ language: "en-US" });
    const repo2 = createSettingsRepository(db);
    expect(repo2.read().language).toBe("en-US");
  });
});
