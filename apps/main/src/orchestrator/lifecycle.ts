import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import crossSpawn from "cross-spawn";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolveSkillTools, type Agent } from "@dashboard-agent/shared";
import { parseStreamLine, type ParsedEvent } from "./stream-parser.js";
import { buildSpawnEnv, type SpawnEnv } from "./env.js";
import { writeMcpConfigFile } from "./mcp-config.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";

// On Windows, cross-spawn must wrap `claude.cmd` invocations through `cmd.exe /d /s /c "..."`.
// When the parent is the Electron main process, that cmd.exe wrapper breaks stdio handle
// inheritance — claude stays alive but emits zero bytes back. Verified by repro: spawning
// the .exe directly via PowerShell yields stream-json output in <1s with the same args.
// We resolve the real .exe (npm-installed adjacent to claude.cmd) and spawn it without
// cmd.exe. Falls back to cross-spawn on non-Windows or when the exe can't be located.
const findClaudeExe = (): string | null => {
  if (process.platform !== "win32") return null;
  const pathDirs = (process.env["PATH"] ?? "").split(";").filter((d) => d !== "");
  for (const dir of pathDirs) {
    const directExe = join(dir, "claude.exe");
    if (existsSync(directExe)) return directExe;
  }
  // npm-installed CLIs put a thin .cmd wrapper alongside node_modules/<pkg>/bin/<bin>.exe
  for (const dir of pathDirs) {
    const cmd = join(dir, "claude.cmd");
    if (existsSync(cmd)) {
      const candidate = join(
        dir,
        "node_modules",
        "@anthropic-ai",
        "claude-code",
        "bin",
        "claude.exe",
      );
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
};

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
  /**
   * Override CWD for the spawned claude process. Production callers should leave this
   * unset — defaults to the agent's per-agent sandbox cwd dir. Tests pass an explicit cwd.
   */
  cwd?: string;
  /**
   * Base directory for per-agent sandbox storage. When provided, each agent gets a
   * persistent `<userDataDir>/agent-sandbox/<agentId>/` as its CLAUDE_CONFIG_DIR — sessions
   * survive restarts but the agent still cannot see the host user's ~/.claude/ config.
   * When omitted (tests / non-Electron callers), falls back to an ephemeral mkdtemp dir.
   */
  userDataDir?: string;
  /** Absolute path to the SQLite database file — forwarded to the MCP child process. */
  dbPath: string;
  /** Absolute path to the permissions directory — forwarded to the MCP child process. */
  permissionsDir: string;
  /** Absolute path to the events directory — forwarded to the MCP child process. */
  eventsDir: string;
};

// Per-agent sandbox CWD. The agent spawns inside this empty directory, so tools that
// operate on CWD (ls, pwd, cat README.md) cannot leak project files even if the agent
// has misconfigured allowedProjects. Real project work requires absolute paths, which
// the security gate validates against allowedProjectPaths.
export const getAgentSandboxCwd = (userDataDir: string, agentId: string): string =>
  join(userDataDir, "agent-sandbox", agentId, "cwd");

// Internal helper that builds the args (factored out so tests can verify args without spawn)
//
// We deliberately omit `-p` (--print): that flag makes claude wait for stdin EOF before
// emitting any assistant output, which is incompatible with the persistent runner that
// streams JSONL user messages over time without ever closing stdin. Verified live against
// claude 2.1.138 — without -p, claude streams `system/init` → `assistant` → `result` per
// turn and stays alive for follow-ups, which is exactly what the orchestrator needs.
//
// `--strict-mcp-config` ensures the spawned claude only sees our dashboard MCP server
// (the one in `--mcp-config`) and ignores any global MCP servers the host user has
// configured (Slack, Drive, Meta Ads, etc). Combined with CLAUDE_CONFIG_DIR pointing at
// an empty per-spawn dir (set in spawnAgent), this enforces the agent sandbox.
export const buildClaudeArgs = (agent: Agent, mcpConfigPath: string): string[] => {
  const allowedTools = resolveSkillTools(agent.skills);
  const args = [
    "--system-prompt",
    buildAgentSystemPrompt(agent.systemPrompt, agent.skills),
    "--model",
    agent.model,
    "--allowedTools",
    allowedTools.join(","),
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    // Permission gating is configured via per-agent CLAUDE_CONFIG_DIR/settings.json
    // (written in spawnAgent before this CLI invokes). Settings allow our MCP
    // orchestration tools and ask for filesystem tools. The --permission-prompt-tool
    // is the route claude uses to ask in non-interactive stream-json mode.
    "--permission-mode",
    "default",
    "--permission-prompt-tool",
    "mcp__dashboard__request_permission",
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

export type EnsureRunnerOptions = SpawnOptions;

export const ensureRunner = (opts: EnsureRunnerOptions, cb: RunnerCallbacks): AgentRunner => {
  const existing = getRunner(opts.agent.id);
  if (existing !== undefined && existing.isAlive()) return existing;
  const r = spawnAgent(opts, cb);
  registerRunner(r);
  return r;
};

export const spawnAgent = (opts: SpawnOptions, cb: RunnerCallbacks): AgentRunner => {
  if (activeRunnerCount() >= MAX_CONCURRENT_AGENTS) {
    throw new Error(
      `Max concurrent agents (${String(MAX_CONCURRENT_AGENTS)}) reached. Kill one before spawning a new agent.`,
    );
  }

  const env: SpawnEnv = buildSpawnEnv(
    opts.agent,
    opts.oauthToken,
    opts.dbPath,
    opts.permissionsDir,
    opts.eventsDir,
  );
  // tsup bundles src/index.ts → dist/index.js (single file, splitting:false), so at
  // runtime __dirname resolves to dist/, not dist/orchestrator/. The MCP server is a
  // separate entry → dist/mcp/server.js. Resolve relative to dist/, not the source layout.
  const mcpServerPath = opts.mcpServerJsPath ?? resolve(__dirname, "./mcp/server.js");
  const mcpConfigPath = writeMcpConfigFile(mcpServerPath, env);
  const args = buildClaudeArgs(opts.agent, mcpConfigPath);

  // Sandbox lockdown: point claude at a CLAUDE_CONFIG_DIR isolated from the host user's
  // ~/.claude/ — no SessionStart hooks (superpowers leaked ~17k cache_creation tokens per
  // spawn), no global MCP servers (Slack/Drive/Meta Ads/Canva/Figma), no skills, no
  // plugins, no slash commands. Combined with --strict-mcp-config in buildClaudeArgs,
  // this enforces a real per-agent sandbox.
  //
  // When userDataDir is provided (production), use a persistent per-agent dir so claude
  // sessions (which it stores under CLAUDE_CONFIG_DIR/projects/...) survive across spawns
  // — required for --resume to work. Without it (tests), fall back to an ephemeral dir.
  let agentConfigDir: string;
  let isEphemeralConfigDir: boolean;
  let agentSandboxCwd: string;
  if (opts.userDataDir !== undefined) {
    agentConfigDir = join(opts.userDataDir, "agent-sandbox", opts.agent.id);
    mkdirSync(agentConfigDir, { recursive: true });
    agentSandboxCwd = getAgentSandboxCwd(opts.userDataDir, opts.agent.id);
    mkdirSync(agentSandboxCwd, { recursive: true });
    isEphemeralConfigDir = false;
  } else {
    agentConfigDir = mkdtempSync(join(tmpdir(), "da-claude-cfg-"));
    agentSandboxCwd = mkdtempSync(join(tmpdir(), "da-agent-cwd-"));
    isEphemeralConfigDir = true;
  }
  const spawnCwd = opts.cwd ?? agentSandboxCwd;
  // claude reads the OAuth Max token from <CLAUDE_CONFIG_DIR>/.credentials.json (keychain)
  // and only falls back to env vars in --bare mode. The agent uses the same Anthropic
  // account as the host user (same machine, same OAuth Max), so seed the sandbox keychain
  // with the user's. This intentionally shares the credential — but blocks everything else
  // (hooks, skills, global MCP servers, projects, sessions, shell-snapshots).
  const hostCreds = join(homedir(), ".claude", ".credentials.json");
  const sandboxCreds = join(agentConfigDir, ".credentials.json");
  if (existsSync(hostCreds)) {
    try {
      copyFileSync(hostCreds, sandboxCreds);
    } catch (e) {
      dlog(`WARN: could not copy host credentials to sandbox: ${(e as Error).message}`);
    }
  }

  // Per-agent settings.json: route filesystem tools through --permission-prompt-tool
  // (ask) and pre-allow our orchestration MCP tools (allow). Required because in
  // stream-json non-interactive mode, --permission-prompt-tool only fires when claude
  // is told to ask via permissions config, not by default.
  const settingsPath = join(agentConfigDir, "settings.json");
  const settingsContent = {
    permissions: {
      ask: ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "MultiEdit", "NotebookEdit"],
      allow: [
        "mcp__dashboard__list_agents",
        "mcp__dashboard__list_projects",
        "mcp__dashboard__hire_agent",
        "mcp__dashboard__fire_agent",
        "mcp__dashboard__message_agent",
        "mcp__dashboard__report_to_user",
        "mcp__dashboard__notify_user",
        "mcp__dashboard__create_issue",
        "mcp__dashboard__read_thread",
        "mcp__dashboard__update_issue",
        "mcp__dashboard__assign_issue",
        "mcp__dashboard__list_issues",
        "mcp__dashboard__check_status",
        "mcp__dashboard__request_permission",
      ],
    },
  };
  try {
    writeFileSync(settingsPath, JSON.stringify(settingsContent, null, 2), "utf8");
  } catch (e) {
    dlog(`WARN: could not write sandbox settings.json: ${(e as Error).message}`);
  }
  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    CLAUDE_CONFIG_DIR: agentConfigDir,
  };

  dlog(`spawn claude for agent=${opts.agent.id} cwd=${spawnCwd}`);
  dlog(`configDir=${agentConfigDir} ephemeral=${String(isEphemeralConfigDir)}`);
  dlog(`args: ${JSON.stringify(args)}`);

  // Prefer direct .exe spawn on Windows to avoid the cmd.exe wrapper that breaks stdio
  // when the parent is Electron main. Fallback to cross-spawn elsewhere or if .exe missing.
  const claudeExe = findClaudeExe();
  dlog(`spawn strategy: ${claudeExe !== null ? `direct exe (${claudeExe})` : "cross-spawn"}`);
  const child: ChildProcess =
    claudeExe !== null
      ? nodeSpawn(claudeExe, args, {
          env: spawnEnv,
          cwd: spawnCwd,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        })
      : crossSpawn("claude", args, {
          env: spawnEnv,
          cwd: spawnCwd,
          stdio: ["pipe", "pipe", "pipe"],
        });

  dlog(`spawned pid=${String(child.pid ?? "unknown")}`);

  child.on("spawn", () => {
    dlog(`spawn event fired pid=${String(child.pid ?? "unknown")}`);
  });

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

  child.on("exit", (code, signal) => {
    dlog(`exit code=${String(code)} signal=${String(signal)}`);
    cb.onExit?.(code);
  });

  child.on("error", (err) => {
    dlog(`error: ${err.message}`);
    cb.onError?.(err);
  });

  const cleanupTmpDirs = (): void => {
    // Always clean the per-spawn mcp config dir; only clean the agent config dir when
    // ephemeral (i.e. tests). The persistent per-agent sandbox stays — it holds the
    // claude session history needed for --resume on the next spawn.
    const dirsToRemove = [dirname(mcpConfigPath)];
    if (isEphemeralConfigDir) dirsToRemove.push(agentConfigDir);
    for (const dir of dirsToRemove) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  };

  const runner: AgentRunner = {
    agentId: opts.agent.id,
    send(message) {
      if (child.stdin === null || !child.stdin.writable) return;
      // With --input-format stream-json, claude expects JSONL user messages on stdin.
      const payload = JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: message }] },
      });
      child.stdin.write(payload + "\n");
    },
    kill() {
      if (!child.killed) child.kill();
      cleanupTmpDirs();
    },
    isAlive() {
      return !child.killed && child.exitCode === null;
    },
  };

  child.on("exit", () => {
    cleanupTmpDirs();
  });

  return runner;
};
