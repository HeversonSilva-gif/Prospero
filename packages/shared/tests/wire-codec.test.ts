import { describe, expect, it } from "vitest";
import { decodeWireMessage, encodeWireMessage, LineFramer } from "../src/wire/codec.js";
import type { WireMessage } from "../src/types/wire-protocol.js";

describe("wire codec", () => {
  it("encode appends exactly one trailing newline", () => {
    const line = encodeWireMessage({
      type: "notification",
      method: "stdout",
      params: { agentId: "a1", line: "x" },
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
  });

  it("encode then decode round-trips a request", () => {
    const msg: WireMessage = {
      type: "request",
      id: "msg_1",
      method: "kill",
      params: { agentId: "a1" },
    };
    expect(decodeWireMessage(encodeWireMessage(msg))).toEqual(msg);
  });

  it("decode tolerates a trailing newline", () => {
    expect(decodeWireMessage('{"type":"notification","method":"exit"}\n')).toEqual({
      type: "notification",
      method: "exit",
    });
  });

  it("decode throws on malformed JSON", () => {
    expect(() => decodeWireMessage("{not json")).toThrow(/malformed JSON/);
  });

  it("decode throws on a request missing id", () => {
    expect(() => decodeWireMessage(JSON.stringify({ type: "request", method: "kill" }))).toThrow(
      /missing id/,
    );
  });

  it("decode throws on an unknown message type", () => {
    expect(() => decodeWireMessage(JSON.stringify({ type: "bogus" }))).toThrow(
      /unknown message type/,
    );
  });
});

describe("LineFramer", () => {
  it("returns each complete line from one chunk", () => {
    const framer = new LineFramer();
    expect(framer.push("a\nb\n")).toEqual(["a", "b"]);
  });

  it("returns nothing for a chunk with no newline", () => {
    const framer = new LineFramer();
    expect(framer.push("partial")).toEqual([]);
  });

  it("buffers a partial line across chunk boundaries", () => {
    const framer = new LineFramer();
    expect(framer.push("hel")).toEqual([]);
    expect(framer.push("lo\nwor")).toEqual(["hello"]);
    expect(framer.push("ld\n")).toEqual(["world"]);
  });

  it("handles many lines in one chunk", () => {
    const framer = new LineFramer();
    expect(framer.push("1\n2\n3\n")).toEqual(["1", "2", "3"]);
  });
});
