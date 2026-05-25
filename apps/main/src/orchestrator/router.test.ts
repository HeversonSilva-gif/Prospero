import { describe, it, expect } from "vitest";
import { createRouter } from "./router.js";

const user = { kind: "user" as const, id: null, name: "CEO" };

describe("createRouter — pending nudge", () => {
  it("prepends a pending nudge to the next immediate turn", () => {
    const writes: Array<{ agentId: string; content: string }> = [];
    const router = createRouter({
      writeStdin: (agentId, content) => writes.push({ agentId, content }),
    });
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t1", "do the thing", user);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toBe("NUDGE\n\n[from: CEO] do the thing");
  });

  it("delivers the nudge on the dequeued turn when the agent is busy", () => {
    const writes: Array<{ content: string }> = [];
    const router = createRouter({ writeStdin: (_a, content) => writes.push({ content }) });
    router.enqueue("a1", "t1", "first", user); // starts turn 1 (no nudge yet)
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t2", "second", user); // queued behind turn 1
    router.onTurnComplete("a1"); // dequeues "second"
    expect(writes[1]?.content).toBe("NUDGE\n\n[from: CEO] second");
  });

  it("clears the nudge after one delivery", () => {
    const writes: string[] = [];
    const router = createRouter({ writeStdin: (_a, content) => writes.push(content) });
    router.setPendingNudge("a1", "NUDGE");
    router.enqueue("a1", "t1", "first", user);
    router.onTurnComplete("a1"); // idle, no queued message
    router.enqueue("a1", "t2", "second", user);
    expect(writes[0]).toBe("NUDGE\n\n[from: CEO] first");
    expect(writes[1]).toBe("[from: CEO] second"); // no nudge the second time
  });

  it("a turn with no pending nudge is written unchanged", () => {
    const writes: string[] = [];
    const router = createRouter({ writeStdin: (_a, content) => writes.push(content) });
    router.enqueue("a1", "t1", "plain", user);
    expect(writes[0]).toBe("[from: CEO] plain");
  });
});

describe("createRouter — pending seed", () => {
  it("prepends a pending seed to the next turn, then clears it", () => {
    const sent: string[] = [];
    const router = createRouter({ writeStdin: (_id, content) => sent.push(content) });
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
    const router = createRouter({ writeStdin: (_id, content) => sent.push(content) });
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
