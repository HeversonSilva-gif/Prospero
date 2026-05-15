import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WireHandlerError } from "@prospero/shared";
import { handleSpawn, type SpawnContext } from "../src/handlers/spawn.js";
import { createRunnerState } from "../src/state.js";
import type { McpListener } from "../src/mcp-mux.js";
import { FakeClaude } from "./fake-claude.js";

type Notification = { method: string; params: unknown };

const fakeMcpListener = (): McpListener => ({
  port: 50000,
  writeToBridge: () => {},
  close: () => {},
});

const makeContext = (fake: FakeClaude): { ctx: SpawnContext; notifications: Notification[] } => {
  const notifications: Notification[] = [];
  const ctx: SpawnContext = {
    state: createRunnerState(),
    notify: (method, params) => notifications.push({ method, params }),
    spawnClaude: () => fake,
    // Returns the mkdtemp root itself (an existing dir) as both config and work
    // dir, so writeContainerMcpConfig can write mcp.json into it.
    prepareSandbox: () => {
      const root = mkdtempSync(join(tmpdir(), "prospero-spawn-"));
      return { configDir: root, workDir: root };
    },
    createMcpListener: () => Promise.resolve(fakeMcpListener()),
    mcpBridgePath: "/app/mcp-bridge.js",
  };
  return { ctx, notifications };
};

const validParams = { agentId: "agent_1", args: ["--model", "claude-sonnet-4-6"] };
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("handleSpawn", () => {
  it("registers the agent and returns its pid", async () => {
    const { ctx } = makeContext(new FakeClaude());
    const result = await handleSpawn(validParams, ctx);
    expect(result).toEqual({ pid: 4242 });
    expect(ctx.state.agents.has("agent_1")).toBe(true);
  });

  it("appends the MCP triplet to the claude argv", async () => {
    const fake = new FakeClaude();
    const { ctx } = makeContext(fake);
    let seenArgs: string[] = [];
    ctx.spawnClaude = (opts) => {
      seenArgs = opts.args;
      return fake;
    };
    await handleSpawn(validParams, ctx);
    expect(seenArgs).toContain("--strict-mcp-config");
    expect(seenArgs).toContain("mcp__dashboard__request_permission");
    expect(seenArgs.slice(0, 2)).toEqual(["--model", "claude-sonnet-4-6"]);
  });

  it("forwards a stdout line as a stdout notification", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    await handleSpawn(validParams, ctx);
    fake.emitStdout('{"type":"system"}\n');
    await tick();
    expect(notifications).toContainEqual({
      method: "stdout",
      params: { agentId: "agent_1", line: '{"type":"system"}' },
    });
  });

  it("redacts secrets from forwarded stderr", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    await handleSpawn(validParams, ctx);
    fake.emitStderr("auth failed for sk-ant-oat01-LeakedToken123\n");
    await tick();
    const stderr = notifications.find((n) => n.method === "stderr");
    expect(stderr?.params).toEqual({ agentId: "agent_1", line: "auth failed for [redacted]" });
  });

  it("emits an exit notification and deregisters on child exit", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    await handleSpawn(validParams, ctx);
    fake.emitExit(0);
    expect(notifications).toContainEqual({
      method: "exit",
      params: { agentId: "agent_1", code: 0 },
    });
    expect(ctx.state.agents.has("agent_1")).toBe(false);
  });

  it("throws spawnFailed (1020) when the agent is already running", async () => {
    const { ctx } = makeContext(new FakeClaude());
    await handleSpawn(validParams, ctx);
    let caught: unknown;
    try {
      await handleSpawn(validParams, ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1020);
  });

  it("throws protocolMismatch (1030) on malformed params", async () => {
    const { ctx } = makeContext(new FakeClaude());
    let caught: unknown;
    try {
      await handleSpawn({ agentId: "agent_1" }, ctx);
    } catch (e) {
      caught = e;
    }
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
