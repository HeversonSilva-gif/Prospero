import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { DEFAULT_CLAUDE_MODEL } from "@prospero/shared";
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
    expect(repo.read()).toEqual({
      language: "pt-BR",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
      executorMode: "atomic",
      activeCompanyId: null,
      authMode: "oauth",
      defaultAgentMode: "supervised",
      defaultAlwaysOn: false,
      derivationsPerDayPerAgent: 3,
      compactionCacheReadThreshold: 75000,
      rateLimitedUntil: null,
      remoteExecution: {
        enabled: false,
        mode: "local-docker",
        vpsHost: "",
        vpsUser: "",
        vpsKeyPath: "",
      },
    });
  });

  it("persists a single field via write()", () => {
    const { repo } = setup();
    repo.write({ theme: "dark" });
    expect(repo.read()).toEqual({
      language: "pt-BR",
      theme: "dark",
      workspaceCwd: null,
      defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
      executorMode: "atomic",
      activeCompanyId: null,
      authMode: "oauth",
      defaultAgentMode: "supervised",
      defaultAlwaysOn: false,
      derivationsPerDayPerAgent: 3,
      compactionCacheReadThreshold: 75000,
      rateLimitedUntil: null,
      remoteExecution: {
        enabled: false,
        mode: "local-docker",
        vpsHost: "",
        vpsUser: "",
        vpsKeyPath: "",
      },
    });
  });

  it("persists multiple fields", () => {
    const { repo } = setup();
    repo.write({ language: "en-US", theme: "dark" });
    expect(repo.read()).toEqual({
      language: "en-US",
      theme: "dark",
      workspaceCwd: null,
      defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
      executorMode: "atomic",
      activeCompanyId: null,
      authMode: "oauth",
      defaultAgentMode: "supervised",
      defaultAlwaysOn: false,
      derivationsPerDayPerAgent: 3,
      compactionCacheReadThreshold: 75000,
      rateLimitedUntil: null,
      remoteExecution: {
        enabled: false,
        mode: "local-docker",
        vpsHost: "",
        vpsUser: "",
        vpsKeyPath: "",
      },
    });
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

  describe("executorMode", () => {
    it("defaults to 'atomic' when unset", () => {
      const { repo } = setup();
      expect(repo.getExecutorMode()).toBe("atomic");
    });

    it("persists narrated and reads back", () => {
      const { repo } = setup();
      repo.setExecutorMode("narrated");
      expect(repo.getExecutorMode()).toBe("narrated");
    });

    it("rejects invalid mode strings", () => {
      const { repo } = setup();
      expect(() => repo.setExecutorMode("invalid" as never)).toThrow(/invalid/i);
    });
  });
});
