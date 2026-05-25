import { describe, expect, it } from "vitest";
import { pickIdleEvictionVictim } from "./eviction.js";

describe("pickIdleEvictionVictim", () => {
  it("returns an idle candidate, skipping non-idle ones", () => {
    const candidates = ["agent_a", "agent_b", "agent_c"];
    const statuses: Record<string, string> = {
      agent_a: "working",
      agent_b: "idle",
      agent_c: "idle",
    };
    const result = pickIdleEvictionVictim(candidates, (id) => statuses[id] ?? null, "agent_x");
    // First idle candidate encountered (agent_b)
    expect(result).toBe("agent_b");
  });

  it("returns null when no candidate is idle", () => {
    const candidates = ["agent_a", "agent_b"];
    const statuses: Record<string, string> = {
      agent_a: "working",
      agent_b: "thinking",
    };
    const result = pickIdleEvictionVictim(candidates, (id) => statuses[id] ?? null, "agent_x");
    expect(result).toBeNull();
  });

  it("never returns exceptId even if it is idle", () => {
    const candidates = ["agent_x", "agent_y"];
    const statuses: Record<string, string> = {
      agent_x: "idle",
      agent_y: "working",
    };
    const result = pickIdleEvictionVictim(candidates, (id) => statuses[id] ?? null, "agent_x");
    // agent_x is idle but is the exceptId; agent_y is not idle → null
    expect(result).toBeNull();
  });

  it("returns null for empty candidate list", () => {
    const result = pickIdleEvictionVictim([], (_id) => "idle", "agent_x");
    expect(result).toBeNull();
  });

  it("skips the exceptId and returns next idle candidate", () => {
    const candidates = ["agent_x", "agent_a", "agent_b"];
    const statuses: Record<string, string> = {
      agent_x: "idle",
      agent_a: "working",
      agent_b: "idle",
    };
    const result = pickIdleEvictionVictim(candidates, (id) => statuses[id] ?? null, "agent_x");
    // agent_x skipped (exceptId), agent_a not idle, agent_b idle → agent_b
    expect(result).toBe("agent_b");
  });
});
