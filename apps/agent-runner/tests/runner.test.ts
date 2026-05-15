import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeWireMessage, encodeWireMessage } from "@prospero/shared";
import { createRunner, type RunnerDeps } from "../src/runner.js";
import type { McpListener } from "../src/mcp-mux.js";
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

// Spawn deps with a real (writable) sandbox dir and an in-memory MCP listener —
// handleSpawn is async and writes mcp.json into configDir.
const spawnDeps = (fake: FakeClaude, written: string[] = []): RunnerDeps => ({
  spawnClaude: () => fake,
  prepareSandbox: () => {
    const root = mkdtempSync(join(tmpdir(), "prospero-runner-"));
    return { configDir: root, workDir: root };
  },
  createMcpListener: (): Promise<McpListener> =>
    Promise.resolve({ port: 50000, writeToBridge: (line) => written.push(line), close: () => {} }),
  mcpBridgePath: "/app/mcp-bridge.js",
});

// The spawn handler is async — poll until the wire response arrives.
const waitForResponse = async (responses: unknown[]): Promise<void> => {
  for (let i = 0; i < 100; i += 1) {
    if (responses.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("waitForResponse: timed out");
};

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
    const runner = createRunner(pair.a, spawnDeps(fake));
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
    await waitForResponse(responses);
    expect(responses[0]).toMatchObject({ type: "response", id: "msg_9", result: { pid: 4242 } });
    expect(runner.state.agents.has("agent_1")).toBe(true);
  });

  it("routes an inbound mcp-data notification to the agent's bridge", async () => {
    const pair = createMemoryTransportPair();
    const fake = new FakeClaude();
    const written: string[] = [];
    const runner = createRunner(pair.a, spawnDeps(fake, written));
    const responses: unknown[] = [];
    pair.b.onData((chunk) => responses.push(decodeWireMessage(chunk)));
    pair.b.send(
      encodeWireMessage({
        type: "request",
        id: "msg_s",
        method: "spawn",
        params: { agentId: "agent_1", args: [] },
      }),
    );
    await waitForResponse(responses);
    pair.b.send(
      encodeWireMessage({
        type: "notification",
        method: "mcp-data",
        params: { agentId: "agent_1", line: '{"jsonrpc":"2.0"}\n' },
      }),
    );
    expect(written).toEqual(['{"jsonrpc":"2.0"}\n']);
    expect(runner.state.agents.has("agent_1")).toBe(true);
  });
});
