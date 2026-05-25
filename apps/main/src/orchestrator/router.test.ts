import { describe, it, expect } from "vitest";
import { createRouter } from "./router.js";

const user = { kind: "user" as const, id: null, name: "CEO" };

// Helper: create a router where the named agents have a live adapter.
const makeRouter = (liveIds: Set<string> = new Set()) => {
  const writes: Array<{ agentId: string; content: string }> = [];
  const router = createRouter({
    writeStdin: (agentId, content) => writes.push({ agentId, content }),
    hasLiveAdapter: (id) => liveIds.has(id),
  });
  return { router, writes };
};

describe("createRouter — pending nudge", () => {
  it("prepends a pending nudge to the next immediate turn", () => {
    const writes: Array<{ agentId: string; content: string }> = [];
    const router = createRouter({
      writeStdin: (agentId, content) => writes.push({ agentId, content }),
      hasLiveAdapter: () => true,
    });
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t1", "do the thing", user);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toBe("NUDGE\n\n[from: CEO] do the thing");
  });

  it("delivers the nudge on the dequeued turn when the agent is busy", () => {
    const writes: Array<{ content: string }> = [];
    const router = createRouter({
      writeStdin: (_a, content) => writes.push({ content }),
      hasLiveAdapter: () => true,
    });
    router.enqueue("a1", "t1", "first", user); // starts turn 1 (no nudge yet)
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t2", "second", user); // queued behind turn 1
    router.onTurnComplete("a1"); // dequeues "second"
    expect(writes[1]?.content).toBe("NUDGE\n\n[from: CEO] second");
  });

  it("clears the nudge after one delivery", () => {
    const writes: string[] = [];
    const router = createRouter({
      writeStdin: (_a, content) => writes.push(content),
      hasLiveAdapter: () => true,
    });
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t1", "first", user);
    router.onTurnComplete("a1"); // idle, no queued message
    router.enqueue("a1", "t2", "second", user);
    expect(writes[0]).toBe("NUDGE\n\n[from: CEO] first");
    expect(writes[1]).toBe("[from: CEO] second"); // no nudge the second time
  });

  it("a turn with no pending nudge is written unchanged", () => {
    const writes: string[] = [];
    const router = createRouter({
      writeStdin: (_a, content) => writes.push(content),
      hasLiveAdapter: () => true,
    });
    router.enqueue("a1", "t1", "plain", user);
    expect(writes[0]).toBe("[from: CEO] plain");
  });
});

describe("createRouter — pending seed", () => {
  it("prepends a pending seed to the next turn, then clears it", () => {
    const sent: string[] = [];
    const router = createRouter({
      writeStdin: (_id, content) => sent.push(content),
      hasLiveAdapter: () => true,
    });
    router.setPendingSeed("ag", "SEED-TEXT");
    router.enqueue("ag", "th", "hello", { kind: "user", id: null, name: "User" });
    expect(sent[0]).toContain("SEED-TEXT");
    expect(sent[0]).toContain("hello");
    // second turn must NOT carry the seed again
    sent.length = 0;
    router.onTurnComplete("ag"); // queue empty → no send
    router.enqueue("ag", "th", "again", { kind: "user", id: null, name: "User" });
    expect(sent[0]).not.toContain("SEED-TEXT");
  });

  it("seed appears before nudge and content when both are parked", () => {
    const sent: string[] = [];
    const router = createRouter({
      writeStdin: (_id, content) => sent.push(content),
      hasLiveAdapter: () => true,
    });
    router.setPendingSeed("ag", "SEED");
    router.setPendingNudge("ag", "NUDGE");
    router.enqueue("ag", "th", "msg", { kind: "user", id: null, name: "User" });
    // Expected order: SEED\n\nNUDGE\n\n[from: User] msg
    expect(sent[0]).toMatch(/SEED[\s\S]*NUDGE[\s\S]*msg/);
    const seedIdx = sent[0]!.indexOf("SEED");
    const nudgeIdx = sent[0]!.indexOf("NUDGE");
    const msgIdx = sent[0]!.indexOf("msg");
    expect(seedIdx).toBeLessThan(nudgeIdx);
    expect(nudgeIdx).toBeLessThan(msgIdx);
  });
});

describe("createRouter — hasLiveAdapter guard (message-hold)", () => {
  it("holds message in queue when hasLiveAdapter returns false", () => {
    const { router, writes } = makeRouter(new Set()); // no live adapters
    router.enqueue("a1", "t1", "hello", user);
    expect(writes).toHaveLength(0);
    expect(router.hasPendingWork("a1")).toBe(true);
    expect(router.listPendingAgentIds()).toContain("a1");
  });

  it("does NOT hold when hasLiveAdapter returns true and no turn in flight", () => {
    const { router, writes } = makeRouter(new Set(["a1"]));
    router.enqueue("a1", "t1", "hello", user);
    expect(writes).toHaveLength(1);
    expect(router.hasPendingWork("a1")).toBe(true); // in-flight turn counts
  });

  it("holds when a turn is in flight even if hasLiveAdapter is true", () => {
    const { router, writes } = makeRouter(new Set(["a1"]));
    router.enqueue("a1", "t1", "first", user); // starts turn
    router.enqueue("a1", "t2", "second", user); // queued — turn in flight
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toBe("[from: CEO] first");
  });

  it("deliverQueued flushes one held message once adapter becomes live", () => {
    const liveIds = new Set<string>(); // start dead
    const writes: Array<{ agentId: string; content: string }> = [];
    const router = createRouter({
      writeStdin: (agentId, content) => writes.push({ agentId, content }),
      hasLiveAdapter: (id) => liveIds.has(id),
    });
    router.enqueue("a1", "t1", "held", user);
    expect(writes).toHaveLength(0);

    // Simulate spawn completing
    liveIds.add("a1");
    router.deliverQueued("a1");

    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toBe("[from: CEO] held");
    // hasPendingWork is true because turn is now in-flight
    expect(router.hasPendingWork("a1")).toBe(true);
    // Completing the turn clears it
    router.onTurnComplete("a1");
    expect(router.hasPendingWork("a1")).toBe(false);
  });

  it("deliverQueued is a no-op when queue is empty", () => {
    const { router, writes } = makeRouter(new Set(["a1"]));
    router.deliverQueued("a1");
    expect(writes).toHaveLength(0);
    expect(router.hasPendingWork("a1")).toBe(false);
  });

  it("deliverQueued is a no-op when adapter is still dead", () => {
    const { router, writes } = makeRouter(new Set()); // no live adapters
    router.enqueue("a1", "t1", "msg", user);
    router.deliverQueued("a1");
    expect(writes).toHaveLength(0);
    expect(router.hasPendingWork("a1")).toBe(true);
  });

  it("hasPendingWork returns false for unknown agent", () => {
    const { router } = makeRouter();
    expect(router.hasPendingWork("unknown")).toBe(false);
  });

  it("listPendingAgentIds returns all agents with pending work in insertion order", () => {
    const liveIds = new Set<string>();
    const router = createRouter({
      writeStdin: () => {},
      hasLiveAdapter: (id) => liveIds.has(id),
    });
    // All held (no live adapters)
    router.enqueue("a1", "t1", "msg", user);
    router.enqueue("a2", "t2", "msg", user);
    router.enqueue("a3", "t3", "msg", user);
    const pending = router.listPendingAgentIds();
    expect(pending).toEqual(["a1", "a2", "a3"]);
  });

  it("resetTurn sets currentTurnThreadId to null", () => {
    const { router } = makeRouter(new Set(["a1"]));
    router.enqueue("a1", "t1", "msg", user); // starts turn, currentTurnThreadId = "t1"
    expect(router.getCurrentThread("a1")).toBe("t1");
    router.resetTurn("a1");
    expect(router.getCurrentThread("a1")).toBeNull();
    // After reset, hasPendingWork is false (no queue either)
    expect(router.hasPendingWork("a1")).toBe(false);
  });

  it("resetTurn on unknown agent is a no-op", () => {
    const { router } = makeRouter();
    expect(() => router.resetTurn("nope")).not.toThrow();
  });
});
