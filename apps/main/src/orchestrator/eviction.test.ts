import { describe, expect, it } from "vitest";
import { pickEvictionVictim, type EvictionCandidate } from "./eviction.js";

const makeInfo =
  (statuses: Record<string, string>, updatedAts: Record<string, number> = {}) =>
  (id: string): EvictionCandidate | null => {
    const s = statuses[id];
    if (s === undefined) return null;
    return { status: s, updatedAt: updatedAts[id] ?? 0 };
  };

describe("pickEvictionVictim", () => {
  it("returns an idle candidate, skipping non-idle ones", () => {
    const candidates = ["agent_a", "agent_b", "agent_c"];
    const result = pickEvictionVictim(
      candidates,
      makeInfo({ agent_a: "working", agent_b: "idle", agent_c: "idle" }),
      "agent_x",
    );
    // First idle candidate encountered (agent_b)
    expect(result).toBe("agent_b");
  });

  it("never returns exceptId even if it is idle", () => {
    const candidates = ["agent_x", "agent_y"];
    const result = pickEvictionVictim(
      candidates,
      makeInfo({ agent_x: "idle", agent_y: "working" }),
      "agent_x",
    );
    // agent_x is idle but is the exceptId; agent_y is not idle → LRU fallback
    expect(result).toBe("agent_y");
  });

  it("skips the exceptId and returns next idle candidate", () => {
    const candidates = ["agent_x", "agent_a", "agent_b"];
    const result = pickEvictionVictim(
      candidates,
      makeInfo({ agent_x: "idle", agent_a: "working", agent_b: "idle" }),
      "agent_x",
    );
    // agent_x skipped (exceptId), agent_a not idle, agent_b idle → agent_b
    expect(result).toBe("agent_b");
  });

  it("falls back to least-recently-updated when none are idle", () => {
    const candidates = ["agent_a", "agent_b", "agent_c"];
    const result = pickEvictionVictim(
      candidates,
      makeInfo(
        { agent_a: "working", agent_b: "thinking", agent_c: "waiting" },
        { agent_a: 3000, agent_b: 1000, agent_c: 2000 },
      ),
      "agent_x",
    );
    // agent_b has the smallest updatedAt → LRU
    expect(result).toBe("agent_b");
  });

  it("returns null when no candidates (only exceptId)", () => {
    const result = pickEvictionVictim(["agent_x"], makeInfo({ agent_x: "idle" }), "agent_x");
    expect(result).toBeNull();
  });

  it("returns null for empty candidate list", () => {
    const result = pickEvictionVictim([], (_id) => null, "agent_x");
    expect(result).toBeNull();
  });
});
