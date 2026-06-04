import { describe, it, expect } from "vitest";
import { shapeReadThread, shapers } from "./shapers.js";

const msg = (i: number, content: string) => ({
  sender_kind: "agent",
  sender_id: `s${String(i)}`,
  content,
  created_at: i,
});

describe("shapeReadThread", () => {
  it("leaves a small thread untouched", () => {
    const input = { messages: [msg(1, "hi"), msg(2, "there")] };
    expect(shapeReadThread(input)).toEqual(input);
  });

  it("keeps the newest messages verbatim and replaces older ones with one sentinel", () => {
    const messages = Array.from({ length: 40 }, (_, i) => msg(i, `body-${String(i)}`));
    const out = shapeReadThread({ messages }) as { messages: Array<Record<string, unknown>> };
    // array shrinks to RECENT(15) + 1 sentinel — small enough the clamp won't cap it
    expect(out.messages).toHaveLength(16);
    // head is the sentinel describing the omitted older messages
    expect(out.messages[0]!.omitted_older_messages).toBe(25);
    // the newest message survives verbatim at the tail
    expect(out.messages[15]).toEqual(msg(39, "body-39"));
    // the oldest real message (m0) is gone
    expect(JSON.stringify(out.messages)).not.toContain("body-0");
  });

  it("returns non-thread shapes untouched", () => {
    expect(shapeReadThread({ foo: "bar" })).toEqual({ foo: "bar" });
    expect(shapeReadThread("not an object")).toBe("not an object");
    expect(shapeReadThread({ messages: "not an array" })).toEqual({ messages: "not an array" });
    expect(shapeReadThread(null)).toBeNull();
  });

  it("is registered under read_thread", () => {
    expect(shapers.get("read_thread")).toBe(shapeReadThread);
  });
});
