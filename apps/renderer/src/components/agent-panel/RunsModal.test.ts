import { describe, expect, it } from "vitest";
import type { Message } from "@dashboard-agent/shared";
import { groupBySession } from "./RunsModal.js";

const msg = (over: Partial<Message>): Message => ({
  id: "m_1",
  threadId: "t_1",
  senderKind: "agent",
  senderId: "ag_1",
  content: "hi",
  kind: "message",
  toolCalls: null,
  createdAt: 1,
  ...over,
});

describe("groupBySession", () => {
  it("returns empty array for empty input", () => {
    expect(groupBySession([])).toEqual([]);
  });

  it("groups contiguous agent messages into one block", () => {
    const out = groupBySession([
      msg({ id: "m1", senderKind: "agent" }),
      msg({ id: "m2", senderKind: "agent" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.turns.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("user message terminates the current block", () => {
    const out = groupBySession([
      msg({ id: "m1", senderKind: "agent" }),
      msg({ id: "m2", senderKind: "user", senderId: null }),
      msg({ id: "m3", senderKind: "agent" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.turns.map((m) => m.id)).toEqual(["m1"]);
    expect(out[1]!.turns.map((m) => m.id)).toEqual(["m3"]);
  });
});
