import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetAdapterMigration,
  migrateAgentsForAuthMode,
  nextAdapterForAuthMode,
  runAdapterMigration,
  setAdapterMigrationRunner,
  type MigrationAgent,
} from "./adapter-migration.js";

describe("nextAdapterForAuthMode (pure)", () => {
  it("api-key: flips the local OAuth adapter to the api-key adapter", () => {
    expect(nextAdapterForAuthMode("claude-oauth-local", "api-key")).toBe("claude-api-key-local");
  });

  it("api-key: leaves an already-api-key agent unchanged (null)", () => {
    expect(nextAdapterForAuthMode("claude-api-key-local", "api-key")).toBeNull();
  });

  it("api-key: NEVER touches the remote-docker adapter (separate axis)", () => {
    expect(nextAdapterForAuthMode("claude-oauth-remote-docker", "api-key")).toBeNull();
  });

  it("oauth: flips the api-key adapter back to the local OAuth adapter", () => {
    expect(nextAdapterForAuthMode("claude-api-key-local", "oauth")).toBe("claude-oauth-local");
  });

  it("oauth: leaves an already-oauth agent unchanged (null)", () => {
    expect(nextAdapterForAuthMode("claude-oauth-local", "oauth")).toBeNull();
  });

  it("oauth: NEVER touches the remote-docker adapter", () => {
    expect(nextAdapterForAuthMode("claude-oauth-remote-docker", "oauth")).toBeNull();
  });
});

type Fakes = {
  agents: MigrationAgent[];
  setAdapterName: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  respawn: ReturnType<typeof vi.fn>;
};

const makeFakes = (
  agents: MigrationAgent[],
  running: Set<string>,
): Fakes & {
  isRunning: (id: string) => boolean;
} => ({
  agents,
  setAdapterName: vi.fn(),
  kill: vi.fn(),
  respawn: vi.fn().mockResolvedValue(undefined),
  isRunning: (id: string) => running.has(id),
});

describe("migrateAgentsForAuthMode", () => {
  it("→ api-key (key present): re-points local OAuth agents and respawns only the live ones", async () => {
    const agents: MigrationAgent[] = [
      { id: "a-oauth-running", adapterName: "claude-oauth-local", status: "thinking" },
      { id: "a-oauth-idle", adapterName: "claude-oauth-local", status: "idle" },
      { id: "a-already-api", adapterName: "claude-api-key-local", status: "idle" },
      { id: "a-remote", adapterName: "claude-oauth-remote-docker", status: "idle" },
    ];
    const running = new Set(["a-oauth-running", "a-remote"]);
    const f = makeFakes(agents, running);

    const result = await migrateAgentsForAuthMode({
      authMode: "api-key",
      hasApiKey: true,
      listAgents: () => f.agents,
      setAdapterName: f.setAdapterName,
      isRunning: f.isRunning,
      kill: f.kill,
      respawn: f.respawn,
    });

    // Only the two local-OAuth agents are re-pointed; remote + already-api are left alone.
    expect(result.migrated.sort()).toEqual(["a-oauth-idle", "a-oauth-running"]);
    expect(f.setAdapterName).toHaveBeenCalledWith("a-oauth-running", "claude-api-key-local");
    expect(f.setAdapterName).toHaveBeenCalledWith("a-oauth-idle", "claude-api-key-local");
    expect(f.setAdapterName).toHaveBeenCalledTimes(2);

    // Only the running one is killed + respawned; the idle one waits for its next spawn.
    expect(result.respawned).toEqual(["a-oauth-running"]);
    expect(f.kill).toHaveBeenCalledTimes(1);
    expect(f.kill).toHaveBeenCalledWith("a-oauth-running");
    expect(f.respawn).toHaveBeenCalledTimes(1);
    expect(f.respawn).toHaveBeenCalledWith("a-oauth-running");
    expect(result.skipped).toBeNull();
  });

  it("→ api-key WITHOUT a saved key: skips entirely (would strand agents in error)", async () => {
    const agents: MigrationAgent[] = [
      { id: "a1", adapterName: "claude-oauth-local", status: "idle" },
    ];
    const f = makeFakes(agents, new Set());

    const result = await migrateAgentsForAuthMode({
      authMode: "api-key",
      hasApiKey: false,
      listAgents: () => f.agents,
      setAdapterName: f.setAdapterName,
      isRunning: f.isRunning,
      kill: f.kill,
      respawn: f.respawn,
    });

    expect(result.skipped).toBe("no-api-key");
    expect(result.migrated).toEqual([]);
    expect(f.setAdapterName).not.toHaveBeenCalled();
    expect(f.respawn).not.toHaveBeenCalled();
  });

  it("→ oauth: re-points api-key agents back (no key needed) and skips terminated", async () => {
    const agents: MigrationAgent[] = [
      { id: "a-api-idle", adapterName: "claude-api-key-local", status: "idle" },
      { id: "a-api-dead", adapterName: "claude-api-key-local", status: "terminated" },
    ];
    const f = makeFakes(agents, new Set());

    const result = await migrateAgentsForAuthMode({
      authMode: "oauth",
      hasApiKey: false,
      listAgents: () => f.agents,
      setAdapterName: f.setAdapterName,
      isRunning: f.isRunning,
      kill: f.kill,
      respawn: f.respawn,
    });

    expect(result.migrated).toEqual(["a-api-idle"]);
    expect(f.setAdapterName).toHaveBeenCalledTimes(1);
    expect(f.setAdapterName).toHaveBeenCalledWith("a-api-idle", "claude-oauth-local");
    expect(f.setAdapterName).not.toHaveBeenCalledWith("a-api-dead", expect.anything());
  });

  it("a respawn failure is swallowed — the migration still counts the re-point", async () => {
    const agents: MigrationAgent[] = [
      { id: "a-running", adapterName: "claude-oauth-local", status: "thinking" },
    ];
    const f = makeFakes(agents, new Set(["a-running"]));
    f.respawn.mockRejectedValueOnce(new Error("spawn boom"));

    const result = await migrateAgentsForAuthMode({
      authMode: "api-key",
      hasApiKey: true,
      listAgents: () => f.agents,
      setAdapterName: f.setAdapterName,
      isRunning: f.isRunning,
      kill: f.kill,
      respawn: f.respawn,
    });

    expect(result.migrated).toEqual(["a-running"]);
    expect(result.respawned).toEqual([]); // respawn threw → not counted, but no throw
  });
});

describe("adapter-migration runner injection", () => {
  afterEach(() => __resetAdapterMigration());

  it("runAdapterMigration is a no-op when no runner is wired (tests/headless)", async () => {
    const result = await runAdapterMigration("api-key");
    expect(result).toEqual({ migrated: [], respawned: [], skipped: null });
  });

  it("runAdapterMigration delegates to the injected runner", async () => {
    const runner = vi.fn().mockResolvedValue({ migrated: ["x"], respawned: ["x"], skipped: null });
    setAdapterMigrationRunner(runner);

    const result = await runAdapterMigration("oauth");

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("oauth");
    expect(result.migrated).toEqual(["x"]);
  });
});
