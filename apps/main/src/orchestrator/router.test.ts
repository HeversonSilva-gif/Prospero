import { describe, it, expect, vi } from "vitest";
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
    router.enqueue("a1", "t1", "do the thing", user, null);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toBe("NUDGE\n\n[from: CEO] do the thing");
  });

  it("delivers the nudge on the dequeued turn when the agent is busy", () => {
    const writes: Array<{ content: string }> = [];
    const router = createRouter({
      writeStdin: (_a, content) => writes.push({ content }),
      hasLiveAdapter: () => true,
    });
    router.enqueue("a1", "t1", "first", user, null); // starts turn 1 (no nudge yet)
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t2", "second", user, null); // queued behind turn 1
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
    router.enqueue("a1", "t1", "first", user, null);
    router.onTurnComplete("a1"); // idle, no queued message
    router.enqueue("a1", "t2", "second", user, null);
    expect(writes[0]).toBe("NUDGE\n\n[from: CEO] first");
    expect(writes[1]).toBe("[from: CEO] second"); // no nudge the second time
  });

  it("a turn with no pending nudge is written unchanged", () => {
    const writes: string[] = [];
    const router = createRouter({
      writeStdin: (_a, content) => writes.push(content),
      hasLiveAdapter: () => true,
    });
    router.enqueue("a1", "t1", "plain", user, null);
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
    router.enqueue("ag", "th", "hello", { kind: "user", id: null, name: "User" }, null);
    expect(sent[0]).toContain("SEED-TEXT");
    expect(sent[0]).toContain("hello");
    // second turn must NOT carry the seed again
    sent.length = 0;
    router.onTurnComplete("ag"); // queue empty → no send
    router.enqueue("ag", "th", "again", { kind: "user", id: null, name: "User" }, null);
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
    router.enqueue("ag", "th", "msg", { kind: "user", id: null, name: "User" }, null);
    // Expected order: SEED\n\nNUDGE\n\n[from: User] msg
    expect(sent[0]).toMatch(/SEED[\s\S]*NUDGE[\s\S]*msg/);
    const seedIdx = sent[0]!.indexOf("SEED");
    const nudgeIdx = sent[0]!.indexOf("NUDGE");
    const msgIdx = sent[0]!.indexOf("msg");
    expect(seedIdx).toBeLessThan(nudgeIdx);
    expect(nudgeIdx).toBeLessThan(msgIdx);
  });
});

describe("createRouter — pending seed durability (persistSeed)", () => {
  it("persists the seed when parked and clears the persisted copy when consumed", () => {
    const persisted: Array<{ id: string; seed: string | null }> = [];
    const router = createRouter({
      writeStdin: () => {},
      hasLiveAdapter: () => true,
      persistSeed: (id, seed) => persisted.push({ id, seed }),
    });
    router.setPendingSeed("ag", "SEED");
    expect(persisted).toContainEqual({ id: "ag", seed: "SEED" });
    // delivering the next turn consumes the seed → the durable copy is cleared
    router.enqueue("ag", "th", "hi", { kind: "user", id: null, name: "User" }, null);
    expect(persisted).toContainEqual({ id: "ag", seed: null });
  });

  it("setPendingSeedIfAbsent does NOT persist when a seed is already parked", () => {
    const persisted: Array<{ id: string; seed: string | null }> = [];
    const router = createRouter({
      writeStdin: () => {},
      hasLiveAdapter: () => true,
      persistSeed: (id, seed) => persisted.push({ id, seed }),
    });
    router.setPendingSeed("ag", "FIRST");
    router.setPendingSeedIfAbsent("ag", "SECOND"); // already parked → no-op
    expect(persisted).toEqual([{ id: "ag", seed: "FIRST" }]);
  });

  it("setPendingSeedIfAbsent persists when nothing is parked (restart re-arm)", () => {
    const persisted: Array<{ id: string; seed: string | null }> = [];
    const router = createRouter({
      writeStdin: () => {},
      hasLiveAdapter: () => true,
      persistSeed: (id, seed) => persisted.push({ id, seed }),
    });
    router.setPendingSeedIfAbsent("ag", "REARMED");
    expect(persisted).toContainEqual({ id: "ag", seed: "REARMED" });
  });
});

describe("createRouter — hasLiveAdapter guard (message-hold)", () => {
  it("holds message in queue when hasLiveAdapter returns false", () => {
    const { router, writes } = makeRouter(new Set()); // no live adapters
    router.enqueue("a1", "t1", "hello", user, null);
    expect(writes).toHaveLength(0);
    expect(router.hasPendingWork("a1")).toBe(true);
    expect(router.listPendingAgentIds()).toContain("a1");
  });

  it("does NOT hold when hasLiveAdapter returns true and no turn in flight", () => {
    const { router, writes } = makeRouter(new Set(["a1"]));
    router.enqueue("a1", "t1", "hello", user, null);
    expect(writes).toHaveLength(1);
    expect(router.hasPendingWork("a1")).toBe(true); // in-flight turn counts
  });

  it("holds when a turn is in flight even if hasLiveAdapter is true", () => {
    const { router, writes } = makeRouter(new Set(["a1"]));
    router.enqueue("a1", "t1", "first", user, null); // starts turn
    router.enqueue("a1", "t2", "second", user, null); // queued — turn in flight
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
    router.enqueue("a1", "t1", "held", user, null);
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
    router.enqueue("a1", "t1", "msg", user, null);
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
    router.enqueue("a1", "t1", "msg", user, null);
    router.enqueue("a2", "t2", "msg", user, null);
    router.enqueue("a3", "t3", "msg", user, null);
    const pending = router.listPendingAgentIds();
    expect(pending).toEqual(["a1", "a2", "a3"]);
  });
});

describe("createRouter — requestDrain callback", () => {
  it("calls requestDrain once when message is held (no live adapter)", () => {
    const requestDrain = vi.fn();
    const router = createRouter({
      writeStdin: () => {},
      hasLiveAdapter: () => false,
      requestDrain,
    });
    router.enqueue("a1", "t1", "hello", user, null);
    expect(requestDrain).toHaveBeenCalledTimes(1);
  });

  it("does NOT call requestDrain when message is delivered immediately (live adapter)", () => {
    const requestDrain = vi.fn();
    const router = createRouter({
      writeStdin: () => {},
      hasLiveAdapter: () => true,
      requestDrain,
    });
    router.enqueue("a1", "t1", "hello", user, null);
    expect(requestDrain).not.toHaveBeenCalled();
  });

  it("does NOT call requestDrain when held because a turn is already in flight (live adapter)", () => {
    const requestDrain = vi.fn();
    const router = createRouter({
      writeStdin: () => {},
      hasLiveAdapter: () => true,
      requestDrain,
    });
    router.enqueue("a1", "t1", "first", user, null); // delivered — starts turn
    requestDrain.mockClear();
    router.enqueue("a1", "t2", "second", user, null); // held: turn in flight, but adapter IS live
    expect(requestDrain).not.toHaveBeenCalled();
  });
});

describe("createRouter — setPendingSeedIfAbsent", () => {
  it("sets pendingSeed when none is currently parked", () => {
    const sent: string[] = [];
    const router = createRouter({
      writeStdin: (_id, content) => sent.push(content),
      hasLiveAdapter: () => true,
    });
    router.setPendingSeedIfAbsent("ag", "RECALL-SEED");
    router.enqueue("ag", "th", "hi", { kind: "user", id: null, name: "User" }, null);
    expect(sent[0]).toContain("RECALL-SEED");
  });

  it("does NOT overwrite an existing parked seed", () => {
    const sent: string[] = [];
    const router = createRouter({
      writeStdin: (_id, content) => sent.push(content),
      hasLiveAdapter: () => true,
    });
    router.setPendingSeed("ag", "COMPACTION-SEED");
    router.setPendingSeedIfAbsent("ag", "RECALL-SEED");
    router.enqueue("ag", "th", "hi", { kind: "user", id: null, name: "User" }, null);
    expect(sent[0]).toContain("COMPACTION-SEED");
    expect(sent[0]).not.toContain("RECALL-SEED");
  });
});

describe("router — messageId threading", () => {
  it("writeStdin receives messageId from enqueue", () => {
    const writeStdin = vi.fn();
    const router = createRouter({
      writeStdin,
      hasLiveAdapter: () => true,
    });

    router.enqueue("a1", "t1", "hello", { kind: "user", id: null, name: "U" }, "m1");

    expect(writeStdin).toHaveBeenCalledWith("a1", "[from: U] hello", "m1");
  });

  it("writeStdin receives null messageId for non-message enqueues", () => {
    const writeStdin = vi.fn();
    const router = createRouter({ writeStdin, hasLiveAdapter: () => true });

    router.enqueue("a1", "t1", "system note", { kind: "user", id: null, name: "U" }, null);

    expect(writeStdin).toHaveBeenCalledWith("a1", "[from: U] system note", null);
  });

  it("queued messages preserve messageId across delivery", () => {
    const writeStdin = vi.fn();
    let alive = false;
    const router = createRouter({ writeStdin, hasLiveAdapter: () => alive });

    router.enqueue("a1", "t1", "queued", { kind: "user", id: null, name: "U" }, "m2");
    expect(writeStdin).not.toHaveBeenCalled();

    alive = true;
    router.deliverQueued("a1");
    expect(writeStdin).toHaveBeenCalledWith("a1", "[from: U] queued", "m2");
  });

  it("onTurnComplete delivers next queued message with its messageId", () => {
    const writeStdin = vi.fn();
    const router = createRouter({ writeStdin, hasLiveAdapter: () => true });

    // First message (currentTurnThreadId becomes t1, immediate writeStdin)
    router.enqueue("a1", "t1", "first", { kind: "user", id: null, name: "U" }, "m1");
    expect(writeStdin).toHaveBeenLastCalledWith("a1", "[from: U] first", "m1");

    // Second message (queued, different thread)
    router.enqueue("a1", "t2", "second", { kind: "user", id: null, name: "U" }, "m2");
    expect(writeStdin).toHaveBeenCalledTimes(1);

    // Turn complete on first → delivers second
    router.onTurnComplete("a1");
    expect(writeStdin).toHaveBeenLastCalledWith("a1", "[from: U] second", "m2");
  });
});
