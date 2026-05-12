import { describe, expect, it } from "vitest";
import { parseStreamLine } from "../src/orchestrator/adapters/claude-oauth-local/stream-parser.js";

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

describe("parseStreamLine — result event with usage (M8)", () => {
  it("parses usage object on result event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 200,
      },
      message: { model: "claude-sonnet-4-6" },
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("turn-complete");
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toEqual({
        input: 100,
        output: 50,
        cache_creation: 1000,
        cache_read: 200,
      });
      expect(parsed.model).toBe("claude-sonnet-4-6");
    }
  });

  it("returns usage undefined when result event has no usage", () => {
    const line = JSON.stringify({ type: "result", subtype: "success" });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("turn-complete");
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toBeUndefined();
      expect(parsed.model).toBeUndefined();
    }
  });

  it("tolerates partial usage (missing cache fields)", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { input_tokens: 42, output_tokens: 17 },
    });
    const parsed = parseStreamLine(line);
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toEqual({
        input: 42,
        output: 17,
        cache_creation: 0,
        cache_read: 0,
      });
    }
  });

  it("returns usage undefined when all token counts are zero or missing", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const parsed = parseStreamLine(line);
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toBeUndefined();
    }
  });

  it("ignores negative token values (defaults to 0)", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { input_tokens: -5, output_tokens: 10 },
    });
    const parsed = parseStreamLine(line);
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toEqual({
        input: 0,
        output: 10,
        cache_creation: 0,
        cache_read: 0,
      });
    }
  });
});
