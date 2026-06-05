import { describe, it, expect } from "vitest";
import { staleApprovalIdsToExpire, type PendingApproval } from "./stale-sweep.js";

const NOW = 100_000_000;
const TTL = 2 * 60 * 60_000; // 2h

const apv = (id: string, agentId: string, ageMs: number): PendingApproval => ({
  id,
  agentId,
  createdAt: NOW - ageMs,
});

describe("staleApprovalIdsToExpire", () => {
  it("expires an old pending approval whose agent is no longer waiting (orphaned)", () => {
    const out = staleApprovalIdsToExpire({
      pending: [apv("a1", "agent-1", TTL + 1)],
      waitingAgentIds: new Set(),
      now: NOW,
      ttlMs: TTL,
    });
    expect(out).toEqual(["a1"]);
  });

  it("does NOT expire an approval whose agent IS waiting (legitimately blocked)", () => {
    const out = staleApprovalIdsToExpire({
      pending: [apv("a1", "agent-1", TTL + 1)],
      waitingAgentIds: new Set(["agent-1"]),
      now: NOW,
      ttlMs: TTL,
    });
    expect(out).toEqual([]);
  });

  it("does NOT expire a fresh approval (within TTL) even if the agent isn't waiting", () => {
    const out = staleApprovalIdsToExpire({
      pending: [apv("a1", "agent-1", 1_000)],
      waitingAgentIds: new Set(),
      now: NOW,
      ttlMs: TTL,
    });
    expect(out).toEqual([]);
  });

  it("expires exactly at the TTL boundary", () => {
    const out = staleApprovalIdsToExpire({
      pending: [apv("a1", "agent-1", TTL)],
      waitingAgentIds: new Set(),
      now: NOW,
      ttlMs: TTL,
    });
    expect(out).toEqual(["a1"]);
  });

  it("filters a mixed batch (the Sofia scenario)", () => {
    const out = staleApprovalIdsToExpire({
      pending: [
        apv("orphan", "idle-agent", 20 * 60 * 60_000), // 20h, not waiting → expire
        apv("blocked", "waiting-agent", 20 * 60 * 60_000), // waiting → keep
        apv("fresh", "busy-agent", 60_000), // 1 min → keep
      ],
      waitingAgentIds: new Set(["waiting-agent"]),
      now: NOW,
      ttlMs: TTL,
    });
    expect(out).toEqual(["orphan"]);
  });

  it("returns empty for no pending approvals", () => {
    expect(
      staleApprovalIdsToExpire({
        pending: [],
        waitingAgentIds: new Set(),
        now: NOW,
        ttlMs: TTL,
      }),
    ).toEqual([]);
  });
});
