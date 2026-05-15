import { describe, expect, it } from "vitest";
import { decodeWireMessage, encodeWireMessage } from "@prospero/shared";
import { createRunner } from "../src/runner.js";
import { createMemoryTransportPair } from "./memory-transport.js";
import { FakeClaude } from "./fake-claude.js";

const handshakeRequest = encodeWireMessage({
  type: "request",
  id: "msg_1",
  method: "handshake",
  params: {
    protocolVersion: 1,
    client: "test",
    clientVersion: "0.0.0",
    credentials: { kind: "oauth", oauthToken: "secret-tok" },
  },
});

describe("createRunner", () => {
  it("answers a handshake request over the transport", async () => {
    const pair = createMemoryTransportPair();
    createRunner(pair.a);
    const responses: unknown[] = [];
    pair.b.onData((chunk) => responses.push(decodeWireMessage(chunk)));
    pair.b.send(handshakeRequest);
    await Promise.resolve();
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      type: "response",
      id: "msg_1",
      result: { protocolVersion: 1, server: "agent-runner" },
    });
  });

  it("answers a health request over the transport", async () => {
    const pair = createMemoryTransportPair();
    createRunner(pair.a);
    const responses: unknown[] = [];
    pair.b.onData((chunk) => responses.push(decodeWireMessage(chunk)));
    pair.b.send(encodeWireMessage({ type: "request", id: "msg_2", method: "health" }));
    await Promise.resolve();
    expect(responses[0]).toMatchObject({ type: "response", id: "msg_2", result: { ok: true } });
  });

  it("records handshake credentials on the runner state", async () => {
    const pair = createMemoryTransportPair();
    const runner = createRunner(pair.a);
    pair.b.send(handshakeRequest);
    await Promise.resolve();
    expect(runner.state.credentials).toEqual({ kind: "oauth", oauthToken: "secret-tok" });
  });

  it("spawns an agent through the wire and tracks it", async () => {
    const pair = createMemoryTransportPair();
    const fake = new FakeClaude();
    const runner = createRunner(pair.a, {
      spawnClaude: () => fake,
      prepareSandbox: (agentId) => ({ configDir: `/c/${agentId}`, workDir: `/w/${agentId}` }),
    });
    const responses: unknown[] = [];
    pair.b.onData((chunk) => responses.push(decodeWireMessage(chunk)));
    pair.b.send(
      encodeWireMessage({
        type: "request",
        id: "msg_9",
        method: "spawn",
        params: { agentId: "agent_1", args: [] },
      }),
    );
    await Promise.resolve();
    expect(responses[0]).toMatchObject({ type: "response", id: "msg_9", result: { pid: 4242 } });
    expect(runner.state.agents.has("agent_1")).toBe(true);
  });
});
