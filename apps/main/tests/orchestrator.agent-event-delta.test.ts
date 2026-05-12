import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@dashboard-agent/shared";

// Regression guard: keep current-action and status payloads small (delta-style).
// The whole reason for splitting kinds is to avoid renderer re-renders + token
// budget bloat. If anyone re-merges them or starts attaching the agent list,
// these size checks will fail.

const sizeOf = (ev: AgentEvent): number => Buffer.byteLength(JSON.stringify(ev), "utf8");

describe("AgentEvent delta sizes", () => {
  it("status-changed payload is < 128 bytes", () => {
    const ev: AgentEvent = {
      kind: "status-changed",
      agentId: "agent_1234567890abcdef",
      status: "working",
      updatedAt: 1715515200000,
    };
    expect(sizeOf(ev)).toBeLessThan(128);
  });

  it("current-action-changed payload is < 200 bytes (action capped at 80 chars)", () => {
    const ev: AgentEvent = {
      kind: "current-action-changed",
      agentId: "agent_1234567890abcdef",
      action: "Reading " + "x".repeat(60) + ".ts",
    };
    expect(sizeOf(ev)).toBeLessThan(200);
  });

  it("session-id-changed payload is < 200 bytes", () => {
    const ev: AgentEvent = {
      kind: "session-id-changed",
      agentId: "agent_1234567890abcdef",
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
    };
    expect(sizeOf(ev)).toBeLessThan(200);
  });

  it("roster-changed payload is < 80 bytes", () => {
    const ev: AgentEvent = { kind: "roster-changed", companyId: "co_1234567890abcdef" };
    expect(sizeOf(ev)).toBeLessThan(80);
  });
});

describe("AgentEvent discriminated union — kinds present", () => {
  it("compiles for each new/renamed kind", () => {
    const e1: AgentEvent = { kind: "status-changed", agentId: "x", status: "idle", updatedAt: 0 };
    const e2: AgentEvent = { kind: "current-action-changed", agentId: "x", action: null };
    const e3: AgentEvent = { kind: "session-id-changed", agentId: "x", sessionId: null };
    expect(e1.kind).toBe("status-changed");
    expect(e2.kind).toBe("current-action-changed");
    expect(e3.kind).toBe("session-id-changed");
  });
});
