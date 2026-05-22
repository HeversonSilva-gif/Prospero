import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAutoModeExpiry,
  AUTO_MODE_EXPIRY_MS,
  type AutoModeExpiryDeps,
  type CreateInboxInput,
} from "./auto-mode-expiry.js";
import type { Agent } from "@prospero/shared";

// --- helpers ----------------------------------------------------------------

const BASE_NOW = 1_000_000_000_000; // arbitrary fixed timestamp

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent_1",
    companyId: "company_1",
    name: "Test Agent",
    role: "engineer",
    systemPrompt: "",
    mode: "auto",
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
    autoModeSetAt: BASE_NOW - AUTO_MODE_EXPIRY_MS - 1, // expired by 1ms
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AutoModeExpiryDeps> = {}): {
  deps: AutoModeExpiryDeps;
  setModeToSupervised: ReturnType<typeof vi.fn>;
  createInboxItem: ReturnType<typeof vi.fn>;
  onAgentReverted: ReturnType<typeof vi.fn>;
} {
  const setModeToSupervised = vi.fn();
  const createInboxItem = vi.fn();
  const onAgentReverted = vi.fn();

  const deps: AutoModeExpiryDeps = {
    now: () => BASE_NOW,
    listExpiredAutoAgents: () => [],
    setModeToSupervised,
    createInboxItem,
    onAgentReverted,
    expiryMs: AUTO_MODE_EXPIRY_MS,
    intervalMs: 999_999, // huge interval — tests call tick() directly
    ...overrides,
  };

  return { deps, setModeToSupervised, createInboxItem, onAgentReverted };
}

// --- tests ------------------------------------------------------------------

describe("createAutoModeExpiry", () => {
  describe("tick()", () => {
    it("reverts an expired auto-mode agent to supervised", () => {
      const expiredAgent = makeAgent();
      const { deps, setModeToSupervised } = makeDeps({
        listExpiredAutoAgents: () => [expiredAgent],
      });

      const expiry = createAutoModeExpiry(deps);
      expiry.tick();

      expect(setModeToSupervised).toHaveBeenCalledWith("agent_1");
    });

    it("creates an inbox notification for the reverted agent", () => {
      const expiredAgent = makeAgent({ name: "Alice" });
      const { deps, createInboxItem } = makeDeps({
        listExpiredAutoAgents: () => [expiredAgent],
      });

      createAutoModeExpiry(deps).tick();

      expect(createInboxItem).toHaveBeenCalledOnce();
      const call = createInboxItem.mock.calls[0]?.[0] as CreateInboxInput;
      expect(call.kind).toBe("auto_mode_expired");
      expect(call.companyId).toBe("company_1");
      expect(call.actorId).toBe("agent_1");
      expect(call.title).toContain("Alice");
      expect(call.requiresAction).toBe(false);
    });

    it("calls onAgentReverted with the correct ids", () => {
      const expiredAgent = makeAgent();
      const { deps, onAgentReverted } = makeDeps({
        listExpiredAutoAgents: () => [expiredAgent],
      });

      createAutoModeExpiry(deps).tick();

      expect(onAgentReverted).toHaveBeenCalledWith("agent_1", "company_1");
    });

    it("records activity via recorder when provided", () => {
      const expiredAgent = makeAgent();
      const recordActivity = vi.fn();
      const { deps } = makeDeps({
        listExpiredAutoAgents: () => [expiredAgent],
        recorder: { recordActivity },
      });

      createAutoModeExpiry(deps).tick();

      expect(recordActivity).toHaveBeenCalledOnce();
      const call = recordActivity.mock.calls[0]?.[0] as {
        payload: { from: string; to: string; reason: string };
      };
      expect(call.payload.from).toBe("auto");
      expect(call.payload.to).toBe("supervised");
      expect(call.payload.reason).toBe("auto_mode_expired_24h");
    });

    it("does nothing when no agents are expired", () => {
      const { deps, setModeToSupervised, createInboxItem, onAgentReverted } = makeDeps({
        listExpiredAutoAgents: () => [],
      });

      createAutoModeExpiry(deps).tick();

      expect(setModeToSupervised).not.toHaveBeenCalled();
      expect(createInboxItem).not.toHaveBeenCalled();
      expect(onAgentReverted).not.toHaveBeenCalled();
    });

    it("processes multiple expired agents independently", () => {
      const agent1 = makeAgent({ id: "a1", companyId: "c1" });
      const agent2 = makeAgent({ id: "a2", companyId: "c1" });
      const { deps, setModeToSupervised, onAgentReverted } = makeDeps({
        listExpiredAutoAgents: () => [agent1, agent2],
      });

      createAutoModeExpiry(deps).tick();

      expect(setModeToSupervised).toHaveBeenCalledTimes(2);
      expect(setModeToSupervised).toHaveBeenCalledWith("a1");
      expect(setModeToSupervised).toHaveBeenCalledWith("a2");
      expect(onAgentReverted).toHaveBeenCalledTimes(2);
    });

    it("continues processing remaining agents if one throws", () => {
      const agent1 = makeAgent({ id: "a1" });
      const agent2 = makeAgent({ id: "a2" });
      const setModeToSupervised = vi.fn().mockImplementationOnce(() => {
        throw new Error("db error");
      });
      const onAgentReverted = vi.fn();
      const { deps } = makeDeps({
        listExpiredAutoAgents: () => [agent1, agent2],
        setModeToSupervised,
        onAgentReverted,
      });

      // Should not throw — error is caught internally
      expect(() => createAutoModeExpiry(deps).tick()).not.toThrow();
      // Second agent was still processed
      expect(setModeToSupervised).toHaveBeenCalledWith("a2");
    });

    it("does not crash if listExpiredAutoAgents throws", () => {
      const { deps } = makeDeps({
        listExpiredAutoAgents: () => {
          throw new Error("db unavailable");
        },
      });
      const expiry = createAutoModeExpiry(deps);
      expect(() => expiry.tick()).not.toThrow();
    });

    it("uses the provided expiryMs to filter agents", () => {
      // listExpiredAutoAgents receives the correct now and expiryMs
      const listFn = vi.fn().mockReturnValue([]);
      const { deps } = makeDeps({
        listExpiredAutoAgents: listFn,
        expiryMs: AUTO_MODE_EXPIRY_MS,
      });

      createAutoModeExpiry(deps).tick();

      expect(listFn).toHaveBeenCalledWith(BASE_NOW, AUTO_MODE_EXPIRY_MS);
    });
  });

  describe("start() / stop()", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("runs tick immediately on start", () => {
      const listFn = vi.fn().mockReturnValue([]);
      const { deps } = makeDeps({ listExpiredAutoAgents: listFn, intervalMs: 60_000 });

      createAutoModeExpiry(deps).start();

      expect(listFn).toHaveBeenCalledOnce();
    });

    it("runs tick again after intervalMs", () => {
      const listFn = vi.fn().mockReturnValue([]);
      const { deps } = makeDeps({ listExpiredAutoAgents: listFn, intervalMs: 60_000 });

      const expiry = createAutoModeExpiry(deps);
      expiry.start();

      vi.advanceTimersByTime(60_000);
      expect(listFn).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(60_000);
      expect(listFn).toHaveBeenCalledTimes(3);

      expiry.stop();
    });

    it("stop() prevents further ticks", () => {
      const listFn = vi.fn().mockReturnValue([]);
      const { deps } = makeDeps({ listExpiredAutoAgents: listFn, intervalMs: 60_000 });

      const expiry = createAutoModeExpiry(deps);
      expiry.start();
      expiry.stop();

      vi.advanceTimersByTime(120_000);
      // Only the initial tick ran
      expect(listFn).toHaveBeenCalledOnce();
    });

    it("stop() is safe to call multiple times", () => {
      const { deps } = makeDeps({ intervalMs: 60_000 });
      const expiry = createAutoModeExpiry(deps);
      expiry.start();
      expect(() => {
        expiry.stop();
        expiry.stop();
      }).not.toThrow();
    });
  });
});
