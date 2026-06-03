import { describe, it, expect } from "vitest";
import { mayOverwriteStatusOnLifecycleEvent, rememberPendingTurn } from "./lifecycle-guards.js";

describe("mayOverwriteStatusOnLifecycleEvent", () => {
  it("allows the status reset when the agent is idle/working", () => {
    expect(mayOverwriteStatusOnLifecycleEvent({ status: "idle", terminatedAt: null })).toBe(true);
    expect(mayOverwriteStatusOnLifecycleEvent({ status: "thinking", terminatedAt: null })).toBe(
      true,
    );
    expect(mayOverwriteStatusOnLifecycleEvent({ status: "working", terminatedAt: null })).toBe(
      true,
    );
  });

  it("allows the reset when the row is gone (live === null)", () => {
    expect(mayOverwriteStatusOnLifecycleEvent(null)).toBe(true);
  });

  it("blocks the reset when the agent is paused (budget pause must survive a code-0 exit)", () => {
    expect(mayOverwriteStatusOnLifecycleEvent({ status: "paused", terminatedAt: null })).toBe(
      false,
    );
  });

  it("blocks the reset when the agent is terminated (by status or by terminatedAt marker)", () => {
    expect(mayOverwriteStatusOnLifecycleEvent({ status: "terminated", terminatedAt: null })).toBe(
      false,
    );
    // zombie row: status was reset to idle but terminatedAt (authoritative) is set
    expect(mayOverwriteStatusOnLifecycleEvent({ status: "idle", terminatedAt: 123 })).toBe(false);
  });
});

describe("rememberPendingTurn", () => {
  it("records the turn when none is pending for the agent", () => {
    const map = new Map<string, { content: string; messageId: string | null }>();
    rememberPendingTurn(map, "a1", { content: "first", messageId: "m1" });
    expect(map.get("a1")).toEqual({ content: "first", messageId: "m1" });
  });

  it("keeps the first unanswered turn and does not clobber it with a later write", () => {
    const map = new Map<string, { content: string; messageId: string | null }>();
    rememberPendingTurn(map, "a1", { content: "first", messageId: "m1" });
    rememberPendingTurn(map, "a1", { content: "second", messageId: "m2" });
    expect(map.get("a1")).toEqual({ content: "first", messageId: "m1" });
  });

  it("scopes per agent", () => {
    const map = new Map<string, { content: string; messageId: string | null }>();
    rememberPendingTurn(map, "a1", { content: "for-a1", messageId: null });
    rememberPendingTurn(map, "a2", { content: "for-a2", messageId: null });
    expect(map.get("a1")?.content).toBe("for-a1");
    expect(map.get("a2")?.content).toBe("for-a2");
  });
});
