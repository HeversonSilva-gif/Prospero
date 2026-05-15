import { describe, it, expect } from "vitest";
import { McpRelay, type McpServerSpawner } from "./mcp-relay.js";
import { FakeMcpServer } from "./test-fixtures.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const setup = (): {
  fake: FakeMcpServer;
  sent: { agentId: string; line: string }[];
  relay: McpRelay;
  spawnArgs: { path: string; env: Record<string, string> }[];
} => {
  const fake = new FakeMcpServer();
  const sent: { agentId: string; line: string }[] = [];
  const spawnArgs: { path: string; env: Record<string, string> }[] = [];
  const spawnMcpServer: McpServerSpawner = (path, env) => {
    spawnArgs.push({ path, env });
    return fake;
  };
  const relay = new McpRelay({
    agentId: "agent_1",
    mcpServerJsPath: "/fake/mcp/server.js",
    env: { AGENT_ID: "agent_1", COMPANY_ID: "co_1" },
    sendMcpData: (agentId, line) => sent.push({ agentId, line }),
    spawnMcpServer,
  });
  return { fake, sent, relay, spawnArgs };
};

describe("McpRelay", () => {
  it("spawns the MCP server with the given path and env on start", () => {
    const { relay, spawnArgs } = setup();
    relay.start();
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?.path).toBe("/fake/mcp/server.js");
    expect(spawnArgs[0]?.env).toMatchObject({ AGENT_ID: "agent_1", COMPANY_ID: "co_1" });
  });

  it("writes an inbound line to the MCP server stdin with a trailing newline", async () => {
    const { fake, relay } = setup();
    relay.start();
    relay.handleData('{"jsonrpc":"2.0","id":1}');
    await tick();
    expect(fake.stdinWrites.join("")).toBe('{"jsonrpc":"2.0","id":1}\n');
  });

  it("does not double the newline when an inbound line already ends with one", async () => {
    const { fake, relay } = setup();
    relay.start();
    relay.handleData('{"jsonrpc":"2.0"}\n');
    await tick();
    expect(fake.stdinWrites.join("")).toBe('{"jsonrpc":"2.0"}\n');
  });

  it("frames MCP server stdout into newline-terminated mcp-data lines", async () => {
    const { fake, sent, relay } = setup();
    relay.start();
    fake.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await tick();
    expect(sent).toEqual([{ agentId: "agent_1", line: '{"jsonrpc":"2.0","id":1,"result":{}}\n' }]);
  });

  it("splits a multi-line stdout chunk into separate mcp-data lines", async () => {
    const { fake, sent, relay } = setup();
    relay.start();
    fake.emitStdout('{"a":1}\n{"b":2}\n');
    await tick();
    expect(sent.map((s) => s.line)).toEqual(['{"a":1}\n', '{"b":2}\n']);
  });

  it("buffers a stdout line split across chunks", async () => {
    const { fake, sent, relay } = setup();
    relay.start();
    fake.emitStdout('{"jsonrpc"');
    fake.emitStdout(':"2.0"}\n');
    await tick();
    expect(sent).toEqual([{ agentId: "agent_1", line: '{"jsonrpc":"2.0"}\n' }]);
  });

  it("kills the MCP server on stop", () => {
    const { fake, relay } = setup();
    relay.start();
    relay.stop();
    expect(fake.killed).toBe(true);
  });

  it("ignores a second start", () => {
    const { relay, spawnArgs } = setup();
    relay.start();
    relay.start();
    expect(spawnArgs).toHaveLength(1);
  });
});
