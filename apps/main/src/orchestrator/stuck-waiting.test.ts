import { describe, it, expect } from "vitest";
import { stuckWaitingAgentIds } from "./stuck-waiting.js";

const NOW = 1_000_000;
const STALE = 120_000; // 2 min

describe("stuckWaitingAgentIds", () => {
  it("heals a waiting agent whose approval is already resolved and has waited past the grace period", () => {
    const out = stuckWaitingAgentIds({
      waiting: [{ id: "a1", updatedAt: NOW - STALE - 1 }],
      pendingApprovalAgentIds: new Set(),
      now: NOW,
      staleMs: STALE,
    });
    expect(out).toEqual(["a1"]);
  });

  it("does NOT heal an agent that still has a pending approval (legitimately blocked)", () => {
    const out = stuckWaitingAgentIds({
      waiting: [{ id: "a1", updatedAt: NOW - STALE - 1 }],
      pendingApprovalAgentIds: new Set(["a1"]),
      now: NOW,
      staleMs: STALE,
    });
    expect(out).toEqual([]);
  });

  it("does NOT heal an agent that only just entered waiting (within the grace period)", () => {
    const out = stuckWaitingAgentIds({
      waiting: [{ id: "a1", updatedAt: NOW - 1_000 }],
      pendingApprovalAgentIds: new Set(),
      now: NOW,
      staleMs: STALE,
    });
    expect(out).toEqual([]);
  });

  it("heals exactly at the grace-period boundary", () => {
    const out = stuckWaitingAgentIds({
      waiting: [{ id: "a1", updatedAt: NOW - STALE }],
      pendingApprovalAgentIds: new Set(),
      now: NOW,
      staleMs: STALE,
    });
    expect(out).toEqual(["a1"]);
  });

  it("filters a mixed batch correctly", () => {
    const out = stuckWaitingAgentIds({
      waiting: [
        { id: "stuck", updatedAt: NOW - STALE - 1 }, // heal
        { id: "blocked", updatedAt: NOW - STALE - 1 }, // pending approval → keep
        { id: "fresh", updatedAt: NOW - 1 }, // too recent → keep
      ],
      pendingApprovalAgentIds: new Set(["blocked"]),
      now: NOW,
      staleMs: STALE,
    });
    expect(out).toEqual(["stuck"]);
  });

  it("returns empty for no waiting agents", () => {
    expect(
      stuckWaitingAgentIds({
        waiting: [],
        pendingApprovalAgentIds: new Set(),
        now: NOW,
        staleMs: STALE,
      }),
    ).toEqual([]);
  });
});
