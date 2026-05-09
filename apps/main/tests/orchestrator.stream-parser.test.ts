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

  it("parses tool_use stream events", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu_1", name: "create_issue", input: {} },
      },
      session_id: "sess_123",
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("tool-use-start");
    if (parsed?.kind === "tool-use-start") {
      expect(parsed.toolUseId).toBe("tu_1");
      expect(parsed.name).toBe("create_issue");
    }
  });

  it("parses content_block_delta as text delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
      session_id: "sess_123",
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("text-delta");
    if (parsed?.kind === "text-delta") expect(parsed.text).toBe("Hello");
  });

  it("returns null on malformed JSON", () => {
    expect(parseStreamLine("{ not json }")).toBeNull();
  });
});
