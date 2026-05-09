import type { ChildProcess } from "node:child_process";
import crossSpawn from "cross-spawn";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import type { Agent } from "@dashboard-agent/shared";
import { parseStreamLine, type ParsedEvent } from "./stream-parser.js";
import { buildSpawnEnv, type SpawnEnv } from "./env.js";
import { writeMcpConfigFile } from "./mcp-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Diagnostic file log — writes to dist/orchestrator.log so we can see what claude
// emits even when stderr/stdout from the Electron main process is hidden.
const logFile = resolve(__dirname, "orchestrator.log");
const dlog = (msg: string): void => {
  try {
    if (!existsSync(__dirname)) mkdirSync(__dirname, { recursive: true });
    appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {
    /* ignore log errors */
  }
};

// Hard cap per Anthropic ToS — single-user OAuth license tolerates ~4 parallel sessions safely.
// Attempting to spawn a 5th throws a clear error. Future budget enforcement (M8) refines this.
export const MAX_CONCURRENT_AGENTS = 4;

export type AgentRunner = {
  agentId: string;
  send(message: string): void;
  kill(): void;
  isAlive(): boolean;
};

export type RunnerCallbacks = {
  onEvent: (event: ParsedEvent) => void;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null) => void;
  onError?: (err: Error) => void;
};

export type SpawnOptions = {
  agent: Agent;
  oauthToken: string;
  mcpServerJsPath?: string;
  cwd?: string;
};

// Internal helper that builds the args (factored out so tests can verify args without spawn)
//
// We deliberately omit `-p` (--print): that flag makes claude wait for stdin EOF before
// emitting any assistant output, which is incompatible with the persistent runner that
// streams JSONL user messages over time without ever closing stdin. Verified live against
// claude 2.1.138 — without -p, claude streams `system/init` → `assistant` → `result` per
// turn and stays alive for follow-ups, which is exactly what the orchestrator needs.
export const buildClaudeArgs = (agent: Agent, mcpConfigPath: string): string[] => {
  const args = [
    "--system-prompt",
    agent.systemPrompt,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config",
    mcpConfigPath,
  ];
  if (agent.claudeSessionId !== null) {
    args.push("--resume", agent.claudeSessionId);
  }
  return args;
};

const runners = new Map<string, AgentRunner>();

export const getRunner = (agentId: string): AgentRunner | undefined => runners.get(agentId);

export const registerRunner = (runner: AgentRunner): void => {
  runners.set(runner.agentId, runner);
};

export const removeRunner = (agentId: string): void => {
  runners.delete(agentId);
};

export const activeRunnerCount = (): number => {
  let count = 0;
  for (const r of runners.values()) {
    if (r.isAlive()) count++;
  }
  return count;
};

export const spawnAgent = (opts: SpawnOptions, cb: RunnerCallbacks): AgentRunner => {
  if (activeRunnerCount() >= MAX_CONCURRENT_AGENTS) {
    throw new Error(
      `Max concurrent agents (${String(MAX_CONCURRENT_AGENTS)}) reached. Kill one before spawning a new agent.`,
    );
  }

  // TODO(sandbox-leak): the spawned claude inherits the host user's ~/.claude config —
  // hooks (e.g. superpowers SessionStart adds ~27k tokens), MCP servers (Slack, Drive…),
  // skills, and slash commands all leak into every agent. Violates token-efficiency and
  // sandbox guarantees. Fix candidates: --strict-mcp-config + CLAUDE_CONFIG_DIR pointing
  // at an isolated dir per spawn. Verified live against claude 2.1.138 on 2026-05-09.
  const env: SpawnEnv = buildSpawnEnv(opts.agent, opts.oauthToken);
  const mcpServerPath = opts.mcpServerJsPath ?? resolve(__dirname, "../mcp/server.js");
  const mcpConfigPath = writeMcpConfigFile(mcpServerPath, env);
  const args = buildClaudeArgs(opts.agent, mcpConfigPath);

  dlog(`spawn claude for agent=${opts.agent.id} cwd=${opts.cwd ?? process.cwd()}`);
  dlog(`args: ${JSON.stringify(args)}`);

  // cross-spawn handles Windows .cmd / .ps1 resolution safely (no shell injection),
  // so we can keep shell behavior off and still find the claude binary across platforms.
  const child: ChildProcess = crossSpawn("claude", args, {
    env: { ...process.env, ...env },
    cwd: opts.cwd ?? process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  dlog(`spawned pid=${String(child.pid ?? "unknown")}`);

  if (child.stdout) {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const preview = line.length > 300 ? line.slice(0, 300) + "..." : line;
      dlog(`stdout: ${preview}`);
      const parsed = parseStreamLine(line);
      if (parsed !== null) cb.onEvent(parsed);
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim() !== "") {
          dlog(`stderr: ${line}`);
          cb.onStderr?.(line);
        }
      }
    });
  }

  child.on("exit", (code) => {
    dlog(`exit code=${String(code)}`);
    cb.onExit?.(code);
  });

  child.on("error", (err) => {
    dlog(`error: ${err.message}`);
    cb.onError?.(err);
  });

  const runner: AgentRunner = {
    agentId: opts.agent.id,
    send(message) {
      if (child.stdin === null || !child.stdin.writable) return;
      // With --input-format stream-json, claude expects JSONL user messages on stdin.
      const payload = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: message }],
        },
      });
      child.stdin.write(payload + "\n");
    },
    kill() {
      if (!child.killed) child.kill();
    },
    isAlive() {
      return !child.killed && child.exitCode === null;
    },
  };

  return runner;
};
