/**
 * Tests for the stale-exit guard in ensureAgentRunner (orchestrator-handlers.ts).
 *
 * Root cause of iss_1fc4b5e4:
 *   restartIfRunning() kills the child process and immediately sets status="idle".
 *   The OS delivers the exit event ~50 ms later (async). Without the guard, the
 *   onExit callback sees code ≠ 0 and overwrites status to "error", also
 *   incorrectly marking recoveryTracker.markErrored.
 *
 * Fix: capture the adapter instance returned by ensureAdapter (thisSpawn).
 *   onExit checks `getAdapter(agentId) === thisSpawn` before acting. If the
 *   adapter was already removed from the Map (intentional kill), it returns early.
 *
 * These tests exercise the guard logic directly against lifecycle.ts functions,
 * using a vi.mock of the adapter registry to inject a controllable adapter.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  AgentAdapter,
  AdapterName,
  AdapterEventListener,
  ParsedEvent,
  UsageEstimate,
  Agent,
  SpawnContext,
} from "@prospero/shared";

// ---------------------------------------------------------------------------
// Controllable mock adapter — lets tests trigger exit manually.
// ---------------------------------------------------------------------------
class ControlledAdapter implements AgentAdapter {
  readonly name: AdapterName = "claude-oauth-local";
  readonly agentId: string;
  private alive = false;
  private readonly exitListeners = new Set<AdapterEventListener<number | null>>();

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  start(): Promise<void> {
    this.alive = true;
    return Promise.resolve();
  }
  sendInput(_text: string): void {}
  onEvent(_cb: AdapterEventListener<ParsedEvent>): () => void {
    return (): void => {};
  }
  onStderr(_cb: AdapterEventListener<string>): () => void {
    return (): void => {};
  }
  onExit(cb: AdapterEventListener<number | null>): () => void {
    this.exitListeners.add(cb);
    return (): void => {
      this.exitListeners.delete(cb);
    };
  }
  kill(): void {
    this.alive = false;
  }
  isAlive(): boolean {
    return this.alive;
  }
  getUsage(): UsageEstimate {
    return { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  }
  getCurrentAction(): string | null {
    return null;
  }

  /** Test helper: simulate the OS delivering the child-process exit event. */
  triggerExit(code: number | null): void {
    for (const cb of this.exitListeners) cb(code);
  }
}

// ---------------------------------------------------------------------------
// Registry mock — injects ControlledAdapter instead of spawning real claude.
// Must be hoisted before the lifecycle import.
// ---------------------------------------------------------------------------
let adapterFactory: (agentId: string) => ControlledAdapter = (id) => new ControlledAdapter(id);

vi.mock("../src/orchestrator/adapters/index.js", () => ({
  createAdapter: (_name: string, ctx: SpawnContext) => adapterFactory(ctx.agent.id),
}));

// Import AFTER mock is hoisted.
import { ensureAdapter, getAdapter, removeAdapter } from "../src/orchestrator/lifecycle.js";
import { createRecoveryTracker } from "../src/orchestrator/recovery-tracker.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const baseAgent: Agent = {
  id: "agent_guard_test",
  companyId: "co_1",
  name: "TestAgent",
  role: "Engineer",
  systemPrompt: "test",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: false,
  canAssign: false,
  trustTier: "novato",
  autoModeSetAt: null,
};

const baseCtx = (): SpawnContext => ({
  agent: baseAgent,
  oauthToken: "test-token",
  dbPath: ":memory:",
  permissionsDir: "/tmp/perm",
  eventsDir: "/tmp/events",
});

// ---------------------------------------------------------------------------
// Helper: wire ensureAdapter with the guard, mirroring orchestrator-handlers.
// Returns { adapter, statusUpdates, erroredIds } so tests can assert behavior.
// ---------------------------------------------------------------------------
async function wireWithGuard(ctx: SpawnContext): Promise<{
  adapter: ControlledAdapter;
  statusUpdates: Array<"idle" | "error">;
  erroredIds: string[];
}> {
  const statusUpdates: Array<"idle" | "error"> = [];
  const erroredIds: string[] = [];
  const recoveryTracker = createRecoveryTracker();

  let thisSpawn: AgentAdapter | null = null;

  const spawned = await ensureAdapter(ctx, {
    onEvent: () => {},
    onExit: (code) => {
      // --- exact guard logic from orchestrator-handlers.ts ---
      const isCurrent = thisSpawn !== null && getAdapter(ctx.agent.id) === thisSpawn;
      if (!isCurrent) return; // stale exit — a newer adapter (or none) owns the id; don't touch the Map
      removeAdapter(ctx.agent.id);
      if (code !== 0) {
        recoveryTracker.markErrored(ctx.agent.id);
        erroredIds.push(ctx.agent.id);
      }
      statusUpdates.push(code === 0 ? "idle" : "error");
    },
  });
  thisSpawn = spawned;

  return { adapter: spawned as ControlledAdapter, statusUpdates, erroredIds };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset lifecycle Map between tests by removing any leftover entry.
  removeAdapter(baseAgent.id);
  // Reset factory to default.
  adapterFactory = (id) => new ControlledAdapter(id);
});

describe("onExit stale-exit guard", () => {
  it("Case 1 (BUG): intentional kill → exit does NOT set status=error and does NOT mark recoveryTracker", async () => {
    const { adapter, statusUpdates, erroredIds } = await wireWithGuard(baseCtx());

    // Simulate restartIfRunning: remove adapter from Map (kill already happened)
    adapter.kill();
    removeAdapter(baseAgent.id);

    // OS delivers exit async — non-zero (SIGTERM on POSIX → null; Windows → 1)
    adapter.triggerExit(1);

    // Guard must block: no status update, no recovery corruption
    expect(statusUpdates).toHaveLength(0);
    expect(erroredIds).toHaveLength(0);
  });

  it("Case 1b: SIGTERM exit (null code) after intentional kill → also blocked by guard", async () => {
    const { adapter, statusUpdates, erroredIds } = await wireWithGuard(baseCtx());

    adapter.kill();
    removeAdapter(baseAgent.id);
    adapter.triggerExit(null); // POSIX SIGTERM → code is null

    expect(statusUpdates).toHaveLength(0);
    expect(erroredIds).toHaveLength(0);
  });

  it("Case 2 (REGRESSION): natural exit (code=0, adapter still in Map) → status set to idle normally", async () => {
    const { adapter, statusUpdates, erroredIds } = await wireWithGuard(baseCtx());

    // No removeAdapter call — normal turn-complete exit
    adapter.triggerExit(0);

    expect(statusUpdates).toEqual(["idle"]);
    expect(erroredIds).toHaveLength(0);
  });

  it("Case 2b: unexpected crash (code=1, adapter still in Map) → status set to error + recovery marked", async () => {
    const { adapter, statusUpdates, erroredIds } = await wireWithGuard(baseCtx());

    adapter.triggerExit(1);

    expect(statusUpdates).toEqual(["error"]);
    expect(erroredIds).toEqual([baseAgent.id]);
  });

  it("Case 3 (QUICK-RESPAWN): new spawn in Map before old exit fires → old exit ignored", async () => {
    const firstAdapter = new ControlledAdapter(baseAgent.id);
    adapterFactory = () => firstAdapter;

    const { statusUpdates, erroredIds } = await wireWithGuard(baseCtx());

    // Simulate: old adapter killed, new adapter spawned for same agent
    firstAdapter.kill();
    removeAdapter(baseAgent.id);

    // Second spawn: a different adapter instance is now in the Map
    const secondAdapter = new ControlledAdapter(baseAgent.id);
    adapterFactory = () => secondAdapter;
    await ensureAdapter(baseCtx(), { onEvent: () => {} });

    // Old exit arrives — thisSpawn (firstAdapter) ≠ getAdapter(id) (secondAdapter)
    firstAdapter.triggerExit(1);

    expect(statusUpdates).toHaveLength(0);
    expect(erroredIds).toHaveLength(0);
    // Regression (model/config change "agent dies"): the stale exit must NOT
    // remove the freshly-respawned adapter from the Map. The new adapter survives.
    expect(getAdapter(baseAgent.id)).toBe(secondAdapter);
  });
});
