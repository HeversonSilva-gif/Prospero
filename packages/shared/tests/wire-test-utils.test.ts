import { describe, expect, it } from "vitest";
import { createMemoryTransportPair } from "./wire-test-utils.js";

describe("createMemoryTransportPair", () => {
  it("delivers what A sends to B's onData handler", () => {
    const pair = createMemoryTransportPair();
    const received: string[] = [];
    pair.b.onData((chunk) => received.push(chunk));
    pair.a.send("hello\n");
    expect(received).toEqual(["hello\n"]);
  });

  it("delivers what B sends to A's onData handler", () => {
    const pair = createMemoryTransportPair();
    const received: string[] = [];
    pair.a.onData((chunk) => received.push(chunk));
    pair.b.send("hi\n");
    expect(received).toEqual(["hi\n"]);
  });

  it("close() fires both ends' onClose handlers", () => {
    const pair = createMemoryTransportPair();
    let aClosed = false;
    let bClosed = false;
    pair.a.onClose(() => {
      aClosed = true;
    });
    pair.b.onClose(() => {
      bClosed = true;
    });
    pair.close();
    expect([aClosed, bClosed]).toEqual([true, true]);
  });
});
