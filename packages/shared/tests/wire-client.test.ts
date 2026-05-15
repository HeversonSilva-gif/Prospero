import { describe, expect, it } from "vitest";
import { WireClient, WireRequestError } from "../src/wire/client.js";
import { decodeWireMessage, encodeWireMessage } from "../src/wire/codec.js";
import { createMemoryTransportPair } from "./wire-test-utils.js";

describe("WireClient", () => {
  it("resolves a request with the matching response result", async () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    pair.b.onData((chunk) => {
      const msg = decodeWireMessage(chunk);
      if (msg.type === "request") {
        pair.b.send(encodeWireMessage({ type: "response", id: msg.id, result: { pong: true } }));
      }
    });
    expect(await client.request("health")).toEqual({ pong: true });
  });

  it("rejects a request when the response carries an error", async () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    pair.b.onData((chunk) => {
      const msg = decodeWireMessage(chunk);
      if (msg.type === "request") {
        pair.b.send(
          encodeWireMessage({
            type: "response",
            id: msg.id,
            error: { code: 1020, message: "boom" },
          }),
        );
      }
    });
    await expect(client.request("spawn")).rejects.toBeInstanceOf(WireRequestError);
    await expect(client.request("spawn")).rejects.toMatchObject({ code: 1020, message: "boom" });
  });

  it("sends params on the request envelope", async () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    let seenParams: unknown;
    pair.b.onData((chunk) => {
      const msg = decodeWireMessage(chunk);
      if (msg.type === "request") {
        seenParams = msg.params;
        pair.b.send(encodeWireMessage({ type: "response", id: msg.id, result: {} }));
      }
    });
    await client.request("kill", { agentId: "a9" });
    expect(seenParams).toEqual({ agentId: "a9" });
  });

  it("dispatches inbound notifications to subscribers", () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    const seen: unknown[] = [];
    const unsubscribe = client.onNotification("stdout", (params) => seen.push(params));
    pair.b.send(
      encodeWireMessage({
        type: "notification",
        method: "stdout",
        params: { agentId: "a1", line: "hi" },
      }),
    );
    expect(seen).toEqual([{ agentId: "a1", line: "hi" }]);
    unsubscribe();
    pair.b.send(
      encodeWireMessage({
        type: "notification",
        method: "stdout",
        params: { agentId: "a1", line: "x" },
      }),
    );
    expect(seen).toHaveLength(1);
  });

  it("rejects pending requests when the transport closes", async () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    const pending = client.request("health");
    pair.close();
    await expect(pending).rejects.toThrow(/transport closed/);
  });
});
