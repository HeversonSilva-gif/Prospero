import { describe, expect, it } from "vitest";
import { createRouter } from "../src/orchestrator/router.js";

describe("router state machine", () => {
  it("idle agent: enqueueMessage writes immediately + sets currentTurnThreadId", () => {
    const writes: Array<{ agentId: string; content: string }> = [];
    const r = createRouter({
      writeStdin: (agentId, content) => writes.push({ agentId, content }),
    });
    r.enqueue("a1", "thr1", "do X", { kind: "user", id: null, name: "User" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ agentId: "a1", content: "[from: User] do X" });
    expect(r.getCurrentThread("a1")).toBe("thr1");
  });

  it("busy agent: subsequent enqueue queues + drains on turn-complete", () => {
    const writes: Array<{ agentId: string; content: string }> = [];
    const r = createRouter({
      writeStdin: (agentId, content) => writes.push({ agentId, content }),
    });
    r.enqueue("a1", "thr1", "msg1", { kind: "user", id: null, name: "U" });
    r.enqueue("a1", "thr2", "msg2", { kind: "agent", id: "ceo", name: "CEO" });
    expect(writes).toHaveLength(1); // queued, not written yet
    r.onTurnComplete("a1");
    expect(writes).toHaveLength(2);
    expect(writes[1].content).toBe("[from: CEO] msg2");
    expect(r.getCurrentThread("a1")).toBe("thr2");
    r.onTurnComplete("a1");
    expect(r.getCurrentThread("a1")).toBe(null);
  });

  it("formats sender prefix in stdin", () => {
    const writes: string[] = [];
    const r = createRouter({ writeStdin: (_a, c) => writes.push(c) });
    r.enqueue("a1", "thr1", "hello", { kind: "agent", id: "ceo", name: "CEO" });
    expect(writes[0]).toBe("[from: CEO] hello");
  });

  it("independent state per agent", () => {
    const writes: Array<{ agentId: string; content: string }> = [];
    const r = createRouter({
      writeStdin: (agentId, content) => writes.push({ agentId, content }),
    });
    r.enqueue("a1", "thr1", "for a1", { kind: "user", id: null, name: "U" });
    r.enqueue("a2", "thr2", "for a2", { kind: "user", id: null, name: "U" });
    expect(r.getCurrentThread("a1")).toBe("thr1");
    expect(r.getCurrentThread("a2")).toBe("thr2");
    expect(writes).toHaveLength(2);
  });
});
