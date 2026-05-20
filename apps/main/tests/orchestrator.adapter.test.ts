import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeOAuthLocalAdapter } from "../src/orchestrator/adapters/claude-oauth-local/adapter.js";
import type { Agent, ParsedEvent, SpawnContext } from "@prospero/shared";

const baseAgent: Agent = {
  id: "agent_1",
  companyId: "co_1",
  name: "CEO",
  role: "Chief Executive Officer",
  systemPrompt: "You are CEO.",
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
};

const baseCtx = (): SpawnContext => ({
  agent: baseAgent,
  oauthToken: "test-token",
  dbPath: join(tmpdir(), "da-test.db"),
  permissionsDir: mkdtempSync(join(tmpdir(), "da-perm-")),
  eventsDir: mkdtempSync(join(tmpdir(), "da-events-")),
});

describe("ClaudeOAuthLocalAdapter (skeleton)", () => {
  it("exposes name and agentId without starting", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    expect(adapter.name).toBe("claude-oauth-local");
    expect(adapter.agentId).toBe("agent_1");
  });

  it("isAlive() is false before start()", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    expect(adapter.isAlive()).toBe(false);
  });

  it("getUsage() returns zero estimate before start()", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    expect(adapter.getUsage()).toEqual({
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
    });
  });

  it("getCurrentAction() returns null before start()", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    expect(adapter.getCurrentAction()).toBeNull();
  });

  it("onEvent/onStderr/onExit return unsubscribe functions", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    const unsub1 = adapter.onEvent(() => undefined);
    const unsub2 = adapter.onStderr(() => undefined);
    const unsub3 = adapter.onExit(() => undefined);
    expect(typeof unsub1).toBe("function");
    expect(typeof unsub2).toBe("function");
    expect(typeof unsub3).toBe("function");
    expect(() => {
      unsub1();
      unsub2();
      unsub3();
    }).not.toThrow();
  });

  it("kill() before start() is a no-op (does not throw)", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    expect(() => adapter.kill()).not.toThrow();
  });

  it("sendInput() before start() is a no-op (does not throw)", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    expect(() => adapter.sendInput("hello")).not.toThrow();
  });
});

describe("ClaudeOAuthLocalAdapter — usage accumulation (M8)", () => {
  it("accumulates usage across multiple turn-complete events", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    const internal = adapter as unknown as {
      handleParsedEvent: (e: ParsedEvent) => void;
    };
    internal.handleParsedEvent({
      kind: "turn-complete",
      usage: { input: 10, output: 5, cache_creation: 100, cache_read: 20 },
      model: "claude-sonnet-4-6",
    });
    internal.handleParsedEvent({
      kind: "turn-complete",
      usage: { input: 7, output: 3, cache_creation: 0, cache_read: 5 },
    });
    expect(adapter.getUsage()).toEqual({
      input: 17,
      output: 8,
      cache_creation: 100,
      cache_read: 25,
    });
  });

  it("ignores turn-complete events with no usage", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    const internal = adapter as unknown as {
      handleParsedEvent: (e: ParsedEvent) => void;
    };
    internal.handleParsedEvent({ kind: "turn-complete" });
    expect(adapter.getUsage()).toEqual({
      input: 0,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
  });

  it("emits the event to onEvent listeners after handling", () => {
    const adapter = new ClaudeOAuthLocalAdapter(baseCtx());
    const internal = adapter as unknown as {
      handleParsedEvent: (e: ParsedEvent) => void;
    };
    const events: ParsedEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    internal.handleParsedEvent({
      kind: "turn-complete",
      usage: { input: 1, output: 1, cache_creation: 0, cache_read: 0 },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("turn-complete");
  });
});
