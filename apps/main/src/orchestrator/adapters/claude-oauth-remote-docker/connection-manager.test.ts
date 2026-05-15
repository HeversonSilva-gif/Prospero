import { describe, it, expect, vi } from "vitest";
import { RemoteConnectionManager, type RemoteAgentCallbacks } from "./connection-manager.js";
import { createMemoryTransportPair } from "./memory-transport.js";
import { FakeRunner } from "./fake-runner.js";

const makeCallbacks = (): RemoteAgentCallbacks => ({
  onStdout: vi.fn(),
  onStderr: vi.fn(),
  onExit: vi.fn(),
  onMcpOpen: vi.fn(),
  onMcpData: vi.fn(),
  onMcpClose: vi.fn(),
});

const setup = (): {
  pair: ReturnType<typeof createMemoryTransportPair>;
  runner: FakeRunner;
  manager: RemoteConnectionManager;
} => {
  const pair = createMemoryTransportPair();
  const runner = new FakeRunner(pair.b);
  const manager = new RemoteConnectionManager({ createTransport: () => pair.a });
  return { pair, runner, manager };
};

const spawn = (
  manager: RemoteConnectionManager,
  agentId: string,
  callbacks: RemoteAgentCallbacks,
): Promise<{ pid: number }> =>
  manager.spawnAgent({ agentId, args: [], oauthToken: "tok", callbacks });

describe("RemoteConnectionManager", () => {
  it("connects, handshakes, and spawns an agent", async () => {
    const { runner, manager } = setup();
    const result = await spawn(manager, "agent_1", makeCallbacks());
    expect(result.pid).toBeGreaterThan(0);
    expect(runner.spawned).toEqual(["agent_1"]);
    expect(manager.hasAgent("agent_1")).toBe(true);
  });

  it("passes the host-built args through to the runner spawn", async () => {
    const { runner, manager } = setup();
    await manager.spawnAgent({
      agentId: "agent_1",
      args: ["--model", "claude-x"],
      oauthToken: "tok",
      callbacks: makeCallbacks(),
    });
    expect(runner.spawned).toEqual(["agent_1"]);
  });

  it("rejects when the runner speaks a different protocol version", async () => {
    const { runner, manager } = setup();
    runner.handshakeProtocolVersion = 999;
    await expect(spawn(manager, "agent_1", makeCallbacks())).rejects.toThrow(/protocol/);
  });

  it("routes a stdout notification to the agent's callback", async () => {
    const { runner, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    runner.emitStdout("agent_1", '{"type":"x"}');
    expect(cb.onStdout).toHaveBeenCalledWith('{"type":"x"}');
  });

  it("routes a stderr notification to the agent's callback", async () => {
    const { runner, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    runner.emitStderr("agent_1", "a warning");
    expect(cb.onStderr).toHaveBeenCalledWith("a warning");
  });

  it("delivers exit and forgets the agent", async () => {
    const { runner, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    runner.emitExit("agent_1", 0);
    expect(cb.onExit).toHaveBeenCalledWith(0);
    expect(manager.hasAgent("agent_1")).toBe(false);
  });

  it("routes notifications to the correct agent when several run", async () => {
    const { runner, manager } = setup();
    const cb1 = makeCallbacks();
    const cb2 = makeCallbacks();
    await spawn(manager, "a1", cb1);
    await spawn(manager, "a2", cb2);
    runner.emitStdout("a2", "for-a2");
    expect(cb2.onStdout).toHaveBeenCalledWith("for-a2");
    expect(cb1.onStdout).not.toHaveBeenCalled();
  });

  it("routes mcp-open, mcp-data, and mcp-close to the agent", async () => {
    const { runner, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    runner.emitMcpOpen("agent_1");
    runner.emitMcpData("agent_1", '{"jsonrpc":"2.0"}');
    runner.emitMcpClose("agent_1");
    expect(cb.onMcpOpen).toHaveBeenCalledTimes(1);
    expect(cb.onMcpData).toHaveBeenCalledWith('{"jsonrpc":"2.0"}');
    expect(cb.onMcpClose).toHaveBeenCalledTimes(1);
  });

  it("forwards stdin to the runner", async () => {
    const { runner, manager } = setup();
    await spawn(manager, "agent_1", makeCallbacks());
    manager.sendStdin("agent_1", '{"in":1}\n');
    await Promise.resolve();
    expect(runner.stdinWrites).toEqual([{ agentId: "agent_1", line: '{"in":1}\n' }]);
  });

  it("forwards kill to the runner", async () => {
    const { runner, manager } = setup();
    await spawn(manager, "agent_1", makeCallbacks());
    manager.killAgent("agent_1");
    await Promise.resolve();
    expect(runner.killed).toEqual(["agent_1"]);
  });

  it("forwards mcp-data from the host relay to the runner", async () => {
    const { runner, manager } = setup();
    await spawn(manager, "agent_1", makeCallbacks());
    manager.sendMcpData("agent_1", '{"jsonrpc":"2.0","id":1}\n');
    expect(runner.mcpDataFromHost).toEqual([
      { agentId: "agent_1", line: '{"jsonrpc":"2.0","id":1}\n' },
    ]);
  });

  it("fails every live agent when the transport closes", async () => {
    const { pair, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    pair.close();
    expect(cb.onExit).toHaveBeenCalledWith(null);
    expect(manager.hasAgent("agent_1")).toBe(false);
  });

  it("reports runner health over the live connection", async () => {
    const { manager } = setup();
    await spawn(manager, "agent_1", makeCallbacks());
    const health = await manager.health();
    expect(health.ok).toBe(true);
  });
});
