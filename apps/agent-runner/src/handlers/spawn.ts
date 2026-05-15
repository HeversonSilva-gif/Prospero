import { z } from "zod";
import { LineFramer, WireErrorCode, WireHandlerError, type SpawnResult } from "@prospero/shared";
import type { ClaudeSpawner } from "../claude-process.js";
import type { AgentSandbox } from "../sandbox.js";
import type { McpListener } from "../mcp-mux.js";
import type { RunnerState } from "../state.js";
import { redactSecrets } from "../redact.js";
import { mcpTripletArgs, writeContainerMcpConfig } from "../container-mcp-config.js";

/** Dependencies the spawn handler needs beyond the runner state. */
export type SpawnContext = {
  state: RunnerState;
  notify: (method: string, params: unknown) => void;
  spawnClaude: ClaudeSpawner;
  prepareSandbox: (agentId: string) => AgentSandbox;
  createMcpListener: (agentId: string) => Promise<McpListener>;
  /** Absolute path of the bundled mcp-bridge.js inside the container. */
  mcpBridgePath: string;
};

const spawnParamsSchema = z.object({
  agentId: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
});

// Forwards a child stream as line-delimited wire notifications, applying an
// optional per-line transform (stderr is redacted; stdout passes through).
const forwardLines = (
  stream: NodeJS.ReadableStream | null,
  method: string,
  agentId: string,
  notify: SpawnContext["notify"],
  transform: (line: string) => string = (line) => line,
): void => {
  if (stream === null) return;
  const framer = new LineFramer();
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    for (const line of framer.push(chunk)) notify(method, { agentId, line: transform(line) });
  });
};

/**
 * Validates a spawn request, prepares the agent's sandbox, opens its MCP
 * listener, writes the container mcp.json, spawns `claude` with the MCP triplet
 * appended to the host-built argv, registers it, and wires stdout/stderr/exit
 * to wire notifications. Throws WireHandlerError on bad params or a duplicate.
 */
export const handleSpawn = async (params: unknown, ctx: SpawnContext): Promise<SpawnResult> => {
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
  const mcp = await ctx.createMcpListener(agentId);
  const mcpConfigPath = writeContainerMcpConfig(sandbox.configDir, {
    bridgePath: ctx.mcpBridgePath,
    port: mcp.port,
  });

  const child = ctx.spawnClaude({
    command: "claude",
    args: [...args, ...mcpTripletArgs(mcpConfigPath)],
    env: { ...(env ?? {}), CLAUDE_CONFIG_DIR: sandbox.configDir },
    cwd: sandbox.workDir,
  });

  forwardLines(child.stdout, "stdout", agentId, ctx.notify);
  forwardLines(child.stderr, "stderr", agentId, ctx.notify, redactSecrets);
  child.on("exit", (code) => {
    ctx.notify("exit", { agentId, code });
    mcp.close();
    ctx.state.agents.delete(agentId);
  });

  ctx.state.agents.set(agentId, { child, sandbox, mcp });
  return { pid: child.pid ?? -1 };
};
