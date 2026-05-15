import { describe, it, expect } from "vitest";
import type { ParsedEvent } from "@prospero/shared";
import { ClaudeRemoteDockerAdapter } from "./adapter.js";
import { RemoteConnectionManager } from "./connection-manager.js";
import { createMemoryTransportPair } from "./memory-transport.js";
import { FakeRunner } from "./fake-runner.js";
import { FakeMcpServer, makeSpawnContext } from "./test-fixtures.js";
import { createAdapter } from "../index.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const setup = (): {
  runner: FakeRunner;
  manager: RemoteConnectionManager;
  fakeMcp: FakeMcpServer;
  adapter: ClaudeRemoteDockerAdapter;
} => {
  const pair = createMemoryTransportPair();
  const runner = new FakeRunner(pair.b);
  const manager = new RemoteConnectionManager({ createTransport: () => pair.a });
  const fakeMcp = new FakeMcpServer();
  const adapter = new ClaudeRemoteDockerAdapter(makeSpawnContext(), {
    connectionManager: manager,
    spawnMcpServer: () => fakeMcp,
  });
  return { runner, manager, fakeMcp, adapter };
};

describe("ClaudeRemoteDockerAdapter", () => {
  it("reports its adapter name and agent id", () => {
    const { adapter } = setup();
    expect(adapter.name).toBe("claude-oauth-remote-docker");
    expect(adapter.agentId).toBe("agent_1");
  });

  it("spawns the agent on the runner when started", async () => {
    const { runner, adapter } = setup();
    await adapter.start();
    expect(runner.spawned).toEqual(["agent_1"]);
    expect(adapter.isAlive()).toBe(true);
  });

  it("is not alive before start", () => {
    const { adapter } = setup();
    expect(adapter.isAlive()).toBe(false);
  });

  it("rejects start without an oauth token", async () => {
    const pair = createMemoryTransportPair();
    new FakeRunner(pair.b);
    const manager = new RemoteConnectionManager({ createTransport: () => pair.a });
    const ctx = makeSpawnContext();
    delete ctx.oauthToken;
    const adapter = new ClaudeRemoteDockerAdapter(ctx, { connectionManager: manager });
    await expect(adapter.start()).rejects.toThrow(/oauthToken/);
  });

  it("rejects a second start", async () => {
    const { adapter } = setup();
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow(/already started/);
  });

  it("parses a stdout line into a ParsedEvent", async () => {
    const { runner, adapter } = setup();
    const events: ParsedEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start();
    runner.emitStdout(
      "agent_1",
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess_1" }),
    );
    expect(events).toContainEqual({ kind: "session-init", sessionId: "sess_1" });
  });

  it("accumulates usage from turn-complete events", async () => {
    const { runner, adapter } = setup();
    await adapter.start();
    runner.emitStdout(
      "agent_1",
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 100, output_tokens: 40 },
      }),
    );
    expect(adapter.getUsage()).toEqual({
      input: 100,
      output: 40,
      cache_read: 0,
      cache_creation: 0,
    });
  });

  it("forwards stderr lines to stderr listeners", async () => {
    const { runner, adapter } = setup();
    const lines: string[] = [];
    adapter.onStderr((l) => lines.push(l));
    await adapter.start();
    runner.emitStderr("agent_1", "a warning");
    expect(lines).toEqual(["a warning"]);
  });

  it("sends input as a JSONL user message", async () => {
    const { runner, adapter } = setup();
    await adapter.start();
    adapter.sendInput("hello");
    await Promise.resolve();
    expect(runner.stdinWrites).toEqual([
      {
        agentId: "agent_1",
        line:
          JSON.stringify({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: "hello" }] },
          }) + "\n",
      },
    ]);
  });

  it("kills the agent on the runner and goes not-alive", async () => {
    const { runner, adapter } = setup();
    await adapter.start();
    adapter.kill();
    await Promise.resolve();
    expect(runner.killed).toEqual(["agent_1"]);
    expect(adapter.isAlive()).toBe(false);
  });

  it("emits exit and goes not-alive when the runner reports exit", async () => {
    const { runner, adapter } = setup();
    const exits: (number | null)[] = [];
    adapter.onExit((c) => exits.push(c));
    await adapter.start();
    runner.emitExit("agent_1", 0);
    expect(exits).toEqual([0]);
    expect(adapter.isAlive()).toBe(false);
  });

  it("relays MCP traffic between the runner and the host MCP server", async () => {
    const { runner, fakeMcp, adapter } = setup();
    await adapter.start();
    runner.emitMcpOpen("agent_1");
    runner.emitMcpData("agent_1", '{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await tick();
    expect(fakeMcp.stdinWrites.join("")).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    fakeMcp.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await tick();
    expect(runner.mcpDataFromHost).toContainEqual({
      agentId: "agent_1",
      line: '{"jsonrpc":"2.0","id":1,"result":{}}\n',
    });
  });

  it("stops the MCP relay when the agent exits", async () => {
    const { runner, fakeMcp, adapter } = setup();
    await adapter.start();
    runner.emitMcpOpen("agent_1");
    runner.emitExit("agent_1", 0);
    expect(fakeMcp.killed).toBe(true);
  });
});

describe("createAdapter — claude-oauth-remote-docker", () => {
  it("resolves the remote docker adapter from the registry", () => {
    const adapter = createAdapter("claude-oauth-remote-docker", makeSpawnContext());
    expect(adapter.name).toBe("claude-oauth-remote-docker");
    expect(adapter.agentId).toBe("agent_1");
  });
});
