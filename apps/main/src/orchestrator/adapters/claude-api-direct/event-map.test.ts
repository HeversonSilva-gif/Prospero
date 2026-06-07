import { describe, expect, it } from "vitest";
import { assistantBlocksToEvent, usageToEstimate } from "./event-map.js";

describe("event-map", () => {
  it("maps text + tool_use blocks to an assistant-message ParsedEvent", () => {
    const ev = assistantBlocksToEvent([
      { type: "text", text: "ok" },
      { type: "tool_use", id: "tu_1", name: "create_goal", input: { title: "x" } },
    ]);
    expect(ev?.kind).toBe("assistant-message");
    if (ev?.kind !== "assistant-message") return;
    expect(ev.blocks).toEqual([
      { kind: "text", text: "ok" },
      { kind: "tool-use", id: "tu_1", name: "create_goal", input: { title: "x" } },
    ]);
  });
  it("returns null for an empty block list", () => {
    expect(assistantBlocksToEvent([])).toBeNull();
  });
  it("maps SDK usage to UsageEstimate", () => {
    const u = usageToEstimate({
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 40000,
      cache_read_input_tokens: 0,
    });
    expect(u).toEqual({ input: 10, output: 5, cache_creation: 40000, cache_read: 0 });
  });
});
