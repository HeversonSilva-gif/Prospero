import { z } from "zod";
import { LineFramer, WireErrorCode, WireHandlerError, type SpawnResult } from "@prospero/shared";
import type { ClaudeSpawner } from "../claude-process.js";
import type { AgentSandbox } from "../sandbox.js";
import type { RunnerState } from "../state.js";

/** Dependencies the spawn handler needs beyond the runner state. */
export type SpawnContext = {
  state: RunnerState;
  notify: (method: string, params: unknown) => void;
  spawnClaude: ClaudeSpawner;
  prepareSandbox: (agentId: string) => AgentSandbox;
};

const spawnParamsSchema = z.object({
  agentId: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
});

// Forwards a child stream as line-delimited wire notifications of one method.
const forwardLines = (
  stream: NodeJS.ReadableStream | null,
  method: string,
  agentId: string,
  notify: SpawnContext["notify"],
): void => {
  if (stream === null) return;
  const framer = new LineFramer();
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    for (const line of framer.push(chunk)) notify(method, { agentId, line });
  });
};

/**
 * Validates a spawn request, prepares the agent's sandbox, spawns the `claude`
 * child, registers it, and wires its stdout/stderr/exit to wire notifications.
 * The `claude` argv is taken as-is from params.args — PR-B.3 appends the MCP
 * triplet. Throws WireHandlerError on bad params or a duplicate agent.
 */
export const handleSpawn = (params: unknown, ctx: SpawnContext): SpawnResult => {
  const parsed = spawnParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new WireHandlerError(WireErrorCode.protocolMismatch, "spawn: invalid params");
  }
  const { agentId, args, env } = parsed.data;
  if (ctx.state.agents.has(agentId)) {
    throw new WireHandlerError(
      WireErrorCode.spawnFailed,
      `spawn: agent '${agentId}' already running`,
    );
  }

  const sandbox = ctx.prepareSandbox(agentId);
  const child = ctx.spawnClaude({
    command: "claude",
    args,
    env: { ...(env ?? {}), CLAUDE_CONFIG_DIR: sandbox.configDir },
    cwd: sandbox.workDir,
  });

  forwardLines(child.stdout, "stdout", agentId, ctx.notify);
  forwardLines(child.stderr, "stderr", agentId, ctx.notify);
  child.on("exit", (code) => {
    ctx.notify("exit", { agentId, code });
    ctx.state.agents.delete(agentId);
  });

  ctx.state.agents.set(agentId, { child, sandbox });
  return { pid: child.pid ?? -1 };
};
