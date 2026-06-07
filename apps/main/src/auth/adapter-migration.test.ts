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
  // --- non-CEO (isCeo=false) — original behaviour preserved ---
  it("api-key: flips the local OAuth adapter to the api-key adapter (worker)", () => {
    expect(nextAdapterForAuthMode("claude-oauth-local", "api-key", false)).toBe(
      "claude-api-key-local",
    );
  });

  it("api-key: leaves an already-api-key worker unchanged (null)", () => {
    expect(nextAdapterForAuthMode("claude-api-key-local", "api-key", false)).toBeNull();
  });

  it("api-key: NEVER touches the remote-docker adapter (separate axis)", () => {
    expect(nextAdapterForAuthMode("claude-oauth-remote-docker", "api-key", false)).toBeNull();
  });

  it("oauth: flips the api-key adapter back to the local OAuth adapter (worker)", () => {
    expect(nextAdapterForAuthMode("claude-api-key-local", "oauth", false)).toBe(
      "claude-oauth-local",
    );
  });

  it("oauth: leaves an already-oauth worker unchanged (null)", () => {
    expect(nextAdapterForAuthMode("claude-oauth-local", "oauth", false)).toBeNull();
  });

  it("oauth: NEVER touches the remote-docker adapter", () => {
    expect(nextAdapterForAuthMode("claude-oauth-remote-docker", "oauth", false)).toBeNull();
  });

  // --- CEO-aware cases ---
  it("CEO + api-key: flips oauth-local → api-direct", () => {
    expect(nextAdapterForAuthMode("claude-oauth-local", "api-key", true)).toBe("claude-api-direct");
  });

  it("CEO mistakenly on api-key-local + api-key: flips to api-direct", () => {
    expect(nextAdapterForAuthMode("claude-api-key-local", "api-key", true)).toBe(
      "claude-api-direct",
    );
  });

  it("CEO already on api-direct + api-key: no change (null)", () => {
    expect(nextAdapterForAuthMode("claude-api-direct", "api-key", true)).toBeNull();
  });

  it("CEO + oauth: flips api-direct → oauth-local", () => {
    expect(nextAdapterForAuthMode("claude-api-direct", "oauth", true)).toBe("claude-oauth-local");
  });

  it("CEO + oauth: flips api-key-local → oauth-local", () => {
    expect(nextAdapterForAuthMode("claude-api-key-local", "oauth", true)).toBe(
      "claude-oauth-local",
    );
  });

  it("CEO already on oauth-local + oauth: no change (null)", () => {
    expect(nextAdapterForAuthMode("claude-oauth-local", "oauth", true)).toBeNull();
  });

  it("CEO + remote-docker → null always (location axis, never remapped)", () => {
    expect(nextAdapterForAuthMode("claude-oauth-remote-docker", "api-key", true)).toBeNull();
    expect(nextAdapterForAuthMode("claude-oauth-remote-docker", "oauth", true)).toBeNull();
  });

  // worker should never be pointed to api-direct
  it("worker (isCeo=false) + api-direct + api-key: flips to api-key-local", () => {
    expect(nextAdapterForAuthMode("claude-api-direct", "api-key", false)).toBe(
      "claude-api-key-local",
    );
  });

  it("worker (isCeo=false) + api-direct + oauth: flips to oauth-local", () => {
    expect(nextAdapterForAuthMode("claude-api-direct", "oauth", false)).toBe("claude-oauth-local");
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
  it("→ api-key (key present): re-points local OAuth workers to api-key-local, CEO to api-direct, respawns live ones", async () => {
    const agents: MigrationAgent[] = [
      {
        id: "a-oauth-running",
        adapterName: "claude-oauth-local",
        status: "thinking",
        isCeo: false,
      },
      { id: "a-oauth-idle", adapterName: "claude-oauth-local", status: "idle", isCeo: false },
      {
        id: "a-already-api",
        adapterName: "claude-api-key-local",
        status: "idle",
        isCeo: false,
      },
      {
        id: "a-remote",
        adapterName: "claude-oauth-remote-docker",
        status: "idle",
        isCeo: false,
      },
      { id: "a-ceo", adapterName: "claude-oauth-local", status: "thinking", isCeo: true },
    ];
    const running = new Set(["a-oauth-running", "a-remote", "a-ceo"]);
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

    // workers re-pointed to api-key-local; CEO to api-direct; remote untouched; already-api untouched
    expect(result.migrated.sort()).toEqual(["a-ceo", "a-oauth-idle", "a-oauth-running"]);
    expect(f.setAdapterName).toHaveBeenCalledWith("a-oauth-running", "claude-api-key-local");
    expect(f.setAdapterName).toHaveBeenCalledWith("a-oauth-idle", "claude-api-key-local");
    expect(f.setAdapterName).toHaveBeenCalledWith("a-ceo", "claude-api-direct");
    expect(f.setAdapterName).toHaveBeenCalledTimes(3);

    // Running ones are killed + respawned; idle + remote not respawned
    expect(result.respawned.sort()).toEqual(["a-ceo", "a-oauth-running"]);
    expect(f.kill).toHaveBeenCalledTimes(2);
    expect(result.skipped).toBeNull();
  });

  it("→ api-key WITHOUT a saved key: skips entirely (would strand agents in error)", async () => {
    const agents: MigrationAgent[] = [
      { id: "a1", adapterName: "claude-oauth-local", status: "idle", isCeo: false },
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

  it("→ oauth: re-points api-key agents and api-direct (CEO) back to oauth-local, skips terminated", async () => {
    const agents: MigrationAgent[] = [
      { id: "a-api-idle", adapterName: "claude-api-key-local", status: "idle", isCeo: false },
      {
        id: "a-api-dead",
        adapterName: "claude-api-key-local",
        status: "terminated",
        isCeo: false,
      },
      { id: "a-ceo-direct", adapterName: "claude-api-direct", status: "idle", isCeo: true },
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

    expect(result.migrated.sort()).toEqual(["a-api-idle", "a-ceo-direct"]);
    expect(f.setAdapterName).toHaveBeenCalledWith("a-api-idle", "claude-oauth-local");
    expect(f.setAdapterName).toHaveBeenCalledWith("a-ceo-direct", "claude-oauth-local");
    expect(f.setAdapterName).not.toHaveBeenCalledWith("a-api-dead", expect.anything());
  });

  it("a respawn failure is swallowed — the migration still counts the re-point", async () => {
    const agents: MigrationAgent[] = [
      {
        id: "a-running",
        adapterName: "claude-oauth-local",
        status: "thinking",
        isCeo: false,
      },
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

  // CEO-specific migration integration tests
  it("CEO oauth-local → api-direct when switching to api-key mode", async () => {
    const agents: MigrationAgent[] = [
      { id: "ceo-1", adapterName: "claude-oauth-local", status: "idle", isCeo: true },
    ];
    const f = makeFakes(agents, new Set());

    const result = await migrateAgentsForAuthMode({
      authMode: "api-key",
      hasApiKey: true,
      listAgents: () => f.agents,
      setAdapterName: f.setAdapterName,
      isRunning: f.isRunning,
      kill: f.kill,
      respawn: f.respawn,
    });

    expect(result.migrated).toEqual(["ceo-1"]);
    expect(f.setAdapterName).toHaveBeenCalledWith("ceo-1", "claude-api-direct");
  });

  it("worker oauth-local → api-key-local when switching to api-key mode", async () => {
    const agents: MigrationAgent[] = [
      { id: "worker-1", adapterName: "claude-oauth-local", status: "idle", isCeo: false },
    ];
    const f = makeFakes(agents, new Set());

    const result = await migrateAgentsForAuthMode({
      authMode: "api-key",
      hasApiKey: true,
      listAgents: () => f.agents,
      setAdapterName: f.setAdapterName,
      isRunning: f.isRunning,
      kill: f.kill,
      respawn: f.respawn,
    });

    expect(result.migrated).toEqual(["worker-1"]);
    expect(f.setAdapterName).toHaveBeenCalledWith("worker-1", "claude-api-key-local");
  });

  it("CEO api-direct → oauth-local when switching to oauth mode", async () => {
    const agents: MigrationAgent[] = [
      { id: "ceo-1", adapterName: "claude-api-direct", status: "idle", isCeo: true },
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

    expect(result.migrated).toEqual(["ceo-1"]);
    expect(f.setAdapterName).toHaveBeenCalledWith("ceo-1", "claude-oauth-local");
  });

  it("remote-docker agent → never remapped regardless of isCeo", async () => {
    const agents: MigrationAgent[] = [
      {
        id: "remote-1",
        adapterName: "claude-oauth-remote-docker",
        status: "idle",
        isCeo: true,
      },
    ];
    const f = makeFakes(agents, new Set());

    const result = await migrateAgentsForAuthMode({
      authMode: "api-key",
      hasApiKey: true,
      listAgents: () => f.agents,
      setAdapterName: f.setAdapterName,
      isRunning: f.isRunning,
      kill: f.kill,
      respawn: f.respawn,
    });

    expect(result.migrated).toEqual([]);
    expect(f.setAdapterName).not.toHaveBeenCalled();
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
