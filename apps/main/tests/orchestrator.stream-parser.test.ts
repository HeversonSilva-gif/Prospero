import { describe, expect, it } from "vitest";
import { parseStreamLine } from "../src/orchestrator/stream-parser.js";

describe("parseStreamLine", () => {
  it("returns null for empty/whitespace lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
  });

  it("parses system/init carrying session_id", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess_123",
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("session-init");
    if (parsed?.kind === "session-init") expect(parsed.sessionId).toBe("sess_123");
  });

  it("ignores other system subtypes (hook_started, etc.)", () => {
    const line = JSON.stringify({ type: "system", subtype: "hook_started" });
    expect(parseStreamLine(line)).toBeNull();
  });

  it("parses assistant text message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "pong" }] },
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("assistant-message");
    if (parsed?.kind === "assistant-message") {
      expect(parsed.blocks).toHaveLength(1);
      const first = parsed.blocks[0]!;
      expect(first.kind).toBe("text");
      if (first.kind === "text") expect(first.text).toBe("pong");
    }
  });

  it("parses assistant message with tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Calling tool" },
          { type: "tool_use", id: "tu_1", name: "create_issue", input: { title: "x" } },
        ],
      },
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("assistant-message");
    if (parsed?.kind === "assistant-message") {
      expect(parsed.blocks).toHaveLength(2);
      expect(parsed.blocks[0]?.kind).toBe("text");
      const second = parsed.blocks[1]!;
      expect(second.kind).toBe("tool-use");
      if (second.kind === "tool-use") {
        expect(second.id).toBe("tu_1");
        expect(second.name).toBe("create_issue");
      }
    }
  });

  it("parses user message with tool_result", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: [{ type: "text", text: '{"ok":true}' }],
          },
        ],
      },
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("tool-result");
    if (parsed?.kind === "tool-result") {
      expect(parsed.toolUseId).toBe("tu_1");
      expect(parsed.content).toBe('{"ok":true}');
      expect(parsed.isError).toBe(false);
    }
  });

  it("parses result event as turn-complete", () => {
    const line = JSON.stringify({ type: "result", subtype: "success" });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("turn-complete");
  });

  it("ignores rate_limit_event", () => {
    expect(parseStreamLine(JSON.stringify({ type: "rate_limit_event" }))).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseStreamLine("{ not json }")).toBeNull();
  });
});
