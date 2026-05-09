import type { ChildProcess } from "node:child_process";
import crossSpawn from "cross-spawn";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Agent } from "@dashboard-agent/shared";
import { parseStreamLine, type ParsedEvent } from "./stream-parser.js";
import { buildSpawnEnv, type SpawnEnv } from "./env.js";
import { writeMcpConfigFile } from "./mcp-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
export const buildClaudeArgs = (agent: Agent, mcpConfigPath: string): string[] => {
  const args = [
    "-p",
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

  const env: SpawnEnv = buildSpawnEnv(opts.agent, opts.oauthToken);
  const mcpServerPath = opts.mcpServerJsPath ?? resolve(__dirname, "../mcp/server.js");
  const mcpConfigPath = writeMcpConfigFile(mcpServerPath, env);
  const args = buildClaudeArgs(opts.agent, mcpConfigPath);

  // cross-spawn handles Windows .cmd / .ps1 resolution safely (no shell injection),
  // so we can keep shell behavior off and still find the claude binary across platforms.
  const child: ChildProcess = crossSpawn("claude", args, {
    env: { ...process.env, ...env },
    cwd: opts.cwd ?? process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (child.stdout) {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const parsed = parseStreamLine(line);
      if (parsed !== null) cb.onEvent(parsed);
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim() !== "") cb.onStderr?.(line);
      }
    });
  }

  child.on("exit", (code) => {
    cb.onExit?.(code);
  });

  child.on("error", (err) => {
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
