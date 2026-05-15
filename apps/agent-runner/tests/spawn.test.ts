import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WireHandlerError } from "@prospero/shared";
import { handleSpawn, type SpawnContext } from "../src/handlers/spawn.js";
import { createRunnerState } from "../src/state.js";
import { FakeClaude } from "./fake-claude.js";

type Notification = { method: string; params: unknown };

const makeContext = (fake: FakeClaude): { ctx: SpawnContext; notifications: Notification[] } => {
  const notifications: Notification[] = [];
  const ctx: SpawnContext = {
    state: createRunnerState(),
    notify: (method, params) => notifications.push({ method, params }),
    spawnClaude: () => fake,
    prepareSandbox: (agentId) => {
      const root = mkdtempSync(join(tmpdir(), "prospero-spawn-"));
      return { configDir: join(root, agentId, "config"), workDir: join(root, agentId, "work") };
    },
  };
  return { ctx, notifications };
};

const validParams = { agentId: "agent_1", args: ["--model", "claude-sonnet-4-6"] };

// Stream `data` events are not reliably synchronous — wait one tick after
// pushing to the fake child's stdout/stderr before asserting.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("handleSpawn", () => {
  it("registers the agent and returns its pid", () => {
    const { ctx } = makeContext(new FakeClaude());
    const result = handleSpawn(validParams, ctx);
    expect(result).toEqual({ pid: 4242 });
    expect(ctx.state.agents.has("agent_1")).toBe(true);
  });

  it("forwards a stdout line as a stdout notification", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    handleSpawn(validParams, ctx);
    fake.emitStdout('{"type":"system"}\n');
    await tick();
    expect(notifications).toContainEqual({
      method: "stdout",
      params: { agentId: "agent_1", line: '{"type":"system"}' },
    });
  });

  it("forwards a stderr line as a stderr notification", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    handleSpawn(validParams, ctx);
    fake.emitStderr("a warning\n");
    await tick();
    expect(notifications).toContainEqual({
      method: "stderr",
      params: { agentId: "agent_1", line: "a warning" },
    });
  });

  it("emits an exit notification and deregisters on child exit", () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    handleSpawn(validParams, ctx);
    fake.emitExit(0);
    expect(notifications).toContainEqual({
      method: "exit",
      params: { agentId: "agent_1", code: 0 },
    });
    expect(ctx.state.agents.has("agent_1")).toBe(false);
  });

  it("throws spawnFailed (1020) when the agent is already running", () => {
    const { ctx } = makeContext(new FakeClaude());
    handleSpawn(validParams, ctx);
    let caught: unknown;
    try {
      handleSpawn(validParams, ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1020);
  });

  it("throws protocolMismatch (1030) on malformed params", () => {
    const { ctx } = makeContext(new FakeClaude());
    let caught: unknown;
    try {
      handleSpawn({ agentId: "agent_1" }, ctx);
    } catch (e) {
      caught = e;
    }
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
