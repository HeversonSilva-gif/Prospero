import { describe, expect, it, vi } from "vitest";
import { runAgenticTurn, type LlmClient } from "./agentic-loop.js";
import type { ParsedEvent } from "@prospero/shared";

const fakeClient = (responses: Array<Record<string, unknown>>): LlmClient => {
  let i = 0;
  return { createMessage: vi.fn(() => Promise.resolve(responses[i++] as never)) };
};

describe("runAgenticTurn", () => {
  it("executes a tool_use round then completes, emitting the right events + usage", async () => {
    const client = fakeClient([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu1", name: "list_goals", input: {} }],
        usage: {
          input_tokens: 5,
          output_tokens: 2,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 100,
        },
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: {
          input_tokens: 3,
          output_tokens: 4,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      },
    ]);
    const events: ParsedEvent[] = [];
    const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
      { role: "user", content: "go" },
    ];
    await runAgenticTurn({
      client,
      model: "claude-opus-4-8",
      system: "SYS",
      tools: [{ name: "list_goals", description: "d", input_schema: { type: "object" } }],
      messages,
      runTool: () => Promise.resolve("no goals"),
      onEvent: (e) => events.push(e),
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("assistant-message");
    expect(kinds).toContain("tool-result");
    expect(kinds.filter((k) => k === "turn-complete").length).toBe(2); // one per create() round
    const last = events.filter((e) => e.kind === "turn-complete").at(-1);
    expect(last?.kind === "turn-complete" && last.usage?.cache_read).toBe(100);
    // messages mutated: original + assistant + tool_results + final assistant
    expect(messages.length).toBe(4);
  });

  it("surfaces a tool error as an is-error tool-result without throwing", async () => {
    const client = fakeClient([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t", name: "x", input: {} }],
        usage: {},
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: {} },
    ]);
    const events: ParsedEvent[] = [];
    await runAgenticTurn({
      client,
      model: "m",
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "go" }],
      runTool: () => Promise.reject(new Error("boom")),
      onEvent: (e) => events.push(e),
    });
    const tr = events.find((e) => e.kind === "tool-result");
    expect(tr?.kind === "tool-result" && tr.isError).toBe(true);
    expect(tr?.kind === "tool-result" && tr.content).toContain("boom");
  });
});
