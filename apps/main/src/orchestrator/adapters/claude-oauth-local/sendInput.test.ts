import { describe, it, expect } from "vitest";
import { buildSendInputPayload } from "./adapter.js";

describe("buildSendInputPayload", () => {
  it("wraps string in a single text block", () => {
    const payload = buildSendInputPayload("hello");
    expect(JSON.parse(payload)).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    });
  });

  it("passes through a ContentBlock array as-is", () => {
    const blocks = [
      { type: "text" as const, text: "see this" },
      {
        type: "image" as const,
        source: { type: "base64" as const, media_type: "image/png", data: "AAAA" },
      },
    ];
    const payload = buildSendInputPayload(blocks);
    const parsed = JSON.parse(payload) as { message: { content: unknown } };
    expect(parsed.message.content).toEqual(blocks);
  });

  it("terminates with newline (stream-json delimiter)", () => {
    expect(buildSendInputPayload("x").endsWith("\n")).toBe(true);
  });
});
