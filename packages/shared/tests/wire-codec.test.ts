import { describe, expect, it } from "vitest";
import { decodeWireMessage, encodeWireMessage } from "../src/wire/codec.js";
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
