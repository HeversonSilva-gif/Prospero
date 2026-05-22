import { describe, expect, it, beforeEach } from "vitest";
import type { Agent } from "@prospero/shared";
import { createRouter } from "../orchestrator/router.js";
import {
  enqueueOrPark,
  drainPausedBacklog,
  pauseBacklog,
  pauseAndStopAgent,
  type PauseStopDeps,
} from "./agents-pause-backlog.js";

const baseAgent: Agent = {
  id: "ag_1",
  companyId: "co_1",
  name: "BackendEng",
  role: "BackendEng",
  systemPrompt: "x".repeat(20),
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
  canHire: true,
  canAssign: true,
  trustTier: "novato",
  autoModeSetAt: null,
};

describe("enqueueOrPark", () => {
  beforeEach(() => {
    pauseBacklog.clear();
  });

  it("forwards to router when agent is idle", () => {
    const writes: string[] = [];
    const router = createRouter({ writeStdin: (_, content) => writes.push(content) });
    enqueueOrPark(baseAgent, router, "thr_1", "hello", {
      kind: "user",
      id: null,
      name: "You",
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("hello");
    expect(pauseBacklog.has(baseAgent.id)).toBe(false);
  });

  it("parks message when agent is paused", () => {
    const writes: string[] = [];
    const router = createRouter({ writeStdin: (_, content) => writes.push(content) });
    const paused: Agent = { ...baseAgent, status: "paused" };
    enqueueOrPark(paused, router, "thr_1", "queued msg", {
      kind: "user",
      id: null,
      name: "You",
    });
    expect(writes).toHaveLength(0);
    expect(pauseBacklog.get(baseAgent.id)).toHaveLength(1);
    expect(pauseBacklog.get(baseAgent.id)![0]!.content).toBe("queued msg");
  });

  it("parks message when agent is terminated", () => {
    const writes: string[] = [];
    const router = createRouter({ writeStdin: (_, content) => writes.push(content) });
    const terminated: Agent = { ...baseAgent, status: "terminated" };
    enqueueOrPark(terminated, router, "thr_1", "no-op", {
      kind: "user",
      id: null,
      name: "You",
    });
    expect(writes).toHaveLength(0);
    expect(pauseBacklog.get(baseAgent.id)).toHaveLength(1);
  });

  it("drainPausedBacklog flushes parked messages through router on resume", () => {
    const writes: string[] = [];
    const router = createRouter({ writeStdin: (_, content) => writes.push(content) });
    const paused: Agent = { ...baseAgent, status: "paused" };
    enqueueOrPark(paused, router, "thr_1", "first", {
      kind: "user",
      id: null,
      name: "You",
    });
    enqueueOrPark(paused, router, "thr_1", "second", {
      kind: "user",
      id: null,
      name: "You",
    });
    expect(writes).toHaveLength(0);

    const drained = drainPausedBacklog(baseAgent.id, router);
    expect(drained).toBe(2);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("first");
    expect(pauseBacklog.has(baseAgent.id)).toBe(false);
  });
});

describe("pauseAndStopAgent", () => {
  const makeDeps = (alive: boolean) => {
    const calls = { killed: 0, removed: 0, paused: [] as Array<string | undefined> };
    const adapter = { isAlive: () => alive, kill: () => (calls.killed += 1) };
    const deps: PauseStopDeps = {
      getAdapter: () => adapter,
      removeAdapter: () => (calls.removed += 1),
      pause: (_id, reason) => calls.paused.push(reason),
    };
    return { deps, calls };
  };

  it("kills + removes the adapter and pauses when the process is alive", () => {
    const { deps, calls } = makeDeps(true);
    const wasAlive = pauseAndStopAgent("ag_1", "budget_exceeded_daily", deps);
    expect(wasAlive).toBe(true);
    expect(calls.killed).toBe(1);
    expect(calls.removed).toBe(1);
    expect(calls.paused).toEqual(["budget_exceeded_daily"]);
  });

  it("only pauses (no kill) when the process is already dead", () => {
    const { deps, calls } = makeDeps(false);
    const wasAlive = pauseAndStopAgent("ag_1", "manual", deps);
    expect(wasAlive).toBe(false);
    expect(calls.killed).toBe(0);
    expect(calls.removed).toBe(0);
    expect(calls.paused).toEqual(["manual"]);
  });

  it("only pauses when there is no adapter at all", () => {
    const calls = { paused: [] as Array<string | undefined> };
    const deps: PauseStopDeps = {
      getAdapter: () => undefined,
      removeAdapter: () => {
        throw new Error("should not remove a missing adapter");
      },
      pause: (_id, reason) => calls.paused.push(reason),
    };
    expect(pauseAndStopAgent("ag_1", undefined, deps)).toBe(false);
    expect(calls.paused).toEqual([undefined]);
  });
});
