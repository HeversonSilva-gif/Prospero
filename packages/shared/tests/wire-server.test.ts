import { describe, expect, it } from "vitest";
import { WireClient } from "../src/wire/client.js";
import { WireHandlerError, WireServer } from "../src/wire/server.js";
import { createMemoryTransportPair } from "./wire-test-utils.js";

describe("WireServer", () => {
  it("routes a request to its handler and returns the result", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    server.handle("health", () => ({ ok: true, uptimeSeconds: 5, activeAgents: 0 }));
    expect(await client.request("health")).toEqual({ ok: true, uptimeSeconds: 5, activeAgents: 0 });
  });

  it("passes request params to the handler", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    let seen: unknown;
    server.handle("kill", (params) => {
      seen = params;
      return {};
    });
    await client.request("kill", { agentId: "a7" });
    expect(seen).toEqual({ agentId: "a7" });
  });

  it("awaits an async handler before responding", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    server.handle("spawn", async () => {
      await Promise.resolve();
      return { pid: 42 };
    });
    expect(await client.request("spawn")).toEqual({ pid: 42 });
  });

  it("returns protocolMismatch (1030) for an unknown method", async () => {
    const pair = createMemoryTransportPair();
    new WireServer(pair.b);
    const client = new WireClient(pair.a);
    await expect(client.request("nope")).rejects.toMatchObject({ code: 1030 });
  });

  it("maps a thrown WireHandlerError to an error response", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    server.handle("spawn", () => {
      throw new WireHandlerError(1020, "no binary");
    });
    await expect(client.request("spawn")).rejects.toMatchObject({
      code: 1020,
      message: "no binary",
    });
  });

  it("maps an unexpected throw to internalError (1090)", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    server.handle("spawn", () => {
      throw new Error("kaboom");
    });
    await expect(client.request("spawn")).rejects.toMatchObject({ code: 1090 });
  });

  it("delivers notifications from the server to the client", () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    const seen: unknown[] = [];
    client.onNotification("exit", (params) => seen.push(params));
    server.notify("exit", { agentId: "a1", code: 0 });
    expect(seen).toEqual([{ agentId: "a1", code: 0 }]);
  });
});
