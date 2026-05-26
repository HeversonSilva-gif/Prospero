import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import crossSpawn from "cross-spawn";
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  AgentAdapter,
  AdapterEventListener,
  AdapterName,
  ParsedEvent,
  SpawnContext,
  UsageEstimate,
} from "@prospero/shared";
import { buildClaudeArgs } from "./build-args.js";
import { findClaudeExe } from "./resolve-binary.js";
import { prepareSandbox, seedSandboxCredentials, writeSandboxSettings } from "./prepare-sandbox.js";
import { parseStreamLine } from "./stream-parser.js";
import { FakeClaude, isFakeClaudeEnabled } from "./fake-claude.js";
import { buildSpawnEnv } from "../../env.js";
import { setupMcpHandshake } from "../../mcp-handshake.js";
import { mergeSpawnEnv } from "../../util/env-merge.js";
import { isAuthError, recoverAgent } from "../../../auth/credential-recovery.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Diagnostic file log. The default path is next to the compiled code, which is
// fine in dev but lives inside a READ-ONLY asar when packaged — so the writes
// failed silently exactly when we needed them (debugging the packaged app).
// start() redirects this to userData (writable) before the first write.
let logFilePath = resolve(__dirname, "../../orchestrator.log");
const dlog = (msg: string): void => {
  try {
    const logDir = dirname(logFilePath);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    appendFileSync(logFilePath, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {
    /* ignore log errors */
  }
};

// One-time diagnostic. Claude reports "Available MCP tools: none" but hides the
// MCP server's own stderr — so we spawn the server exactly as claude does
// (process.execPath as node via ELECTRON_RUN_AS_NODE) and log whether it loads
// and what it prints. This is the only way to see WHY the server provides no
// tools in the packaged app.
let mcpHealthChecked = false;
const mcpHealthCheckOnce = (
  serverPath: string,
  env: {
    AGENT_ID: string;
    COMPANY_ID: string;
    DB_PATH: string;
    PERMISSIONS_DIR: string;
    EVENTS_DIR: string;
  },
): void => {
  if (mcpHealthChecked) return;
  mcpHealthChecked = true;
  try {
    dlog(
      `[mcp-healthcheck] serverPath=${serverPath} exists=${String(existsSync(serverPath))} execPath=${process.execPath}`,
    );
    const child = nodeSpawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        AGENT_ID: env.AGENT_ID,
        COMPANY_ID: env.COMPANY_ID,
        DB_PATH: env.DB_PATH,
        PERMISSIONS_DIR: env.PERMISSIONS_DIR,
        EVENTS_DIR: env.EVENTS_DIR,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let errOut = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d: string) => {
      errOut += d;
    });
    child.on("error", (e) => dlog(`[mcp-healthcheck] spawn error: ${e.message}`));
    child.on("exit", (code, signal) =>
      dlog(
        `[mcp-healthcheck] EXITED EARLY code=${String(code)} signal=${String(signal)} stderr=${errOut.slice(0, 1000)}`,
      ),
    );
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        dlog(
          `[mcp-healthcheck] alive after 2.5s — server loads OK; stderr=${errOut.slice(0, 400)}`,
        );
        child.kill();
      }
    }, 2500);
  } catch (e) {
    dlog(`[mcp-healthcheck] threw: ${e instanceof Error ? e.message : String(e)}`);
  }
};

export class ClaudeOAuthLocalAdapter implements AgentAdapter {
  readonly name: AdapterName = "claude-oauth-local";
  readonly agentId: string;

  private readonly ctx: SpawnContext;
  private child: ChildProcess | null = null;
  private cleanupFn: (() => void) | null = null;
  private currentAction: string | null = null;
  private usage: UsageEstimate = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  private readonly eventListeners = new Set<AdapterEventListener<ParsedEvent>>();
  private readonly stderrListeners = new Set<AdapterEventListener<string>>();
  private readonly exitListeners = new Set<AdapterEventListener<number | null>>();
  private autoRecoveryDebounceTimer: NodeJS.Timeout | null = null;
  private static readonly AUTO_RECOVERY_DEBOUNCE_MS = 10_000;

  private maybeTriggerAutoRecovery(): void {
    if (this.autoRecoveryDebounceTimer !== null) return;
    this.autoRecoveryDebounceTimer = setTimeout(() => {
      this.autoRecoveryDebounceTimer = null;
    }, ClaudeOAuthLocalAdapter.AUTO_RECOVERY_DEBOUNCE_MS);
    void recoverAgent(this.agentId, { reason: "auto-401" });
  }

  constructor(ctx: SpawnContext) {
    this.ctx = ctx;
    this.agentId = ctx.agent.id;
  }

  async start(): Promise<void> {
    if (this.child !== null) {
      throw new Error("Adapter already started; create a new instance to respawn");
    }

    if (this.ctx.oauthToken === undefined) {
      throw new Error("claude-oauth-local requires oauthToken in SpawnContext");
    }
    // Redirect the diagnostic log to a writable location — the default sits
    // inside the read-only asar when packaged. userData/prospero-debug.log is
    // what to ask the user for when the agent misbehaves in the installed app.
    if (this.ctx.userDataDir !== undefined) {
      logFilePath = resolve(this.ctx.userDataDir, "prospero-debug.log");
    }
    const env = buildSpawnEnv(
      this.ctx.agent,
      this.ctx.oauthToken,
      this.ctx.dbPath,
      this.ctx.permissionsDir,
      this.ctx.eventsDir,
    );

    const handshake = setupMcpHandshake(env, this.ctx.mcpServerJsPath);
    mcpHealthCheckOnce(handshake.mcpServerJsPath, env);
    const args = buildClaudeArgs(this.ctx.agent, handshake.mcpConfigPath, {
      ...(this.ctx.narratedActive === true ? { narratedActive: true } : {}),
      ...(this.ctx.telosBlock !== undefined ? { telosBlock: this.ctx.telosBlock } : {}),
      ...(this.ctx.memoryBlock !== undefined ? { memoryBlock: this.ctx.memoryBlock } : {}),
      ...(this.ctx.projectContextBlock !== undefined
        ? { projectContextBlock: this.ctx.projectContextBlock }
        : {}),
      ...(this.ctx.instructionsBlock !== undefined
        ? { instructionsBlock: this.ctx.instructionsBlock }
        : {}),
    });

    const { agentConfigDir, agentSandboxCwd, isEphemeralConfigDir } = prepareSandbox(
      this.ctx.agent.id,
      this.ctx.userDataDir,
    );

    seedSandboxCredentials(agentConfigDir);
    writeSandboxSettings(agentConfigDir);

    const spawnCwd = this.ctx.cwd ?? agentSandboxCwd;
    const spawnEnv = mergeSpawnEnv(env, agentConfigDir);

    dlog(`spawn claude for agent=${this.ctx.agent.id} cwd=${spawnCwd}`);
    dlog(`configDir=${agentConfigDir} ephemeral=${String(isEphemeralConfigDir)}`);
    dlog(`args: ${JSON.stringify(args)}`);

    if (isFakeClaudeEnabled()) {
      dlog(`spawn strategy: FakeClaude stub (E2E mode)`);
      this.child = new FakeClaude() as unknown as ChildProcess;
    } else {
      const claudeExe = findClaudeExe();
      dlog(`spawn strategy: ${claudeExe !== null ? `direct exe (${claudeExe})` : "cross-spawn"}`);
      this.child =
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
    }

    dlog(`spawned pid=${String(this.child.pid ?? "unknown")}`);
    this.child.on("spawn", () => {
      dlog(`spawn event fired pid=${String(this.child?.pid ?? "unknown")}`);
    });

    if (this.child.stdout !== null) {
      const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const preview = line.length > 300 ? line.slice(0, 300) + "..." : line;
        dlog(`stdout: ${preview}`);
        const parsed = parseStreamLine(line);
        if (parsed !== null) this.handleParsedEvent(parsed);
      });
    }

    if (this.child.stderr !== null) {
      this.child.stderr.setEncoding("utf8");
      this.child.stderr.on("data", (chunk: string) => {
        for (const line of chunk.split("\n")) {
          if (line.trim() !== "") {
            dlog(`stderr: ${line}`);
            this.emitStderr(line);
            if (isAuthError(line)) {
              this.maybeTriggerAutoRecovery();
            }
          }
        }
      });
    }

    this.child.on("exit", (code, signal) => {
      dlog(`exit code=${String(code)} signal=${String(signal)}`);
      this.emitExit(code);
    });

    this.child.on("error", (err) => {
      dlog(`error: ${err.message}`);
      this.emitStderr(`adapter-error: ${err.message}`);
    });

    // Cleanup: remove the per-spawn MCP config tmpdir on kill/exit. The persistent
    // per-agent CLAUDE_CONFIG_DIR stays — it holds session history for --resume.
    this.cleanupFn = (): void => {
      const dirsToRemove = [dirname(handshake.mcpConfigPath)];
      if (isEphemeralConfigDir) {
        dirsToRemove.push(agentConfigDir);
        dirsToRemove.push(agentSandboxCwd);
      }
      for (const dir of dirsToRemove) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    };

    this.child.on("exit", () => {
      if (this.cleanupFn !== null) {
        this.cleanupFn();
        this.cleanupFn = null;
      }
    });

    return Promise.resolve();
  }

  sendInput(text: string): void {
    if (this.child === null || this.child.stdin === null || !this.child.stdin.writable) {
      return;
    }
    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    });
    this.child.stdin.write(payload + "\n");
  }

  onEvent(cb: AdapterEventListener<ParsedEvent>): () => void {
    this.eventListeners.add(cb);
    return (): void => {
      this.eventListeners.delete(cb);
    };
  }

  onStderr(cb: AdapterEventListener<string>): () => void {
    this.stderrListeners.add(cb);
    return (): void => {
      this.stderrListeners.delete(cb);
    };
  }

  onExit(cb: AdapterEventListener<number | null>): () => void {
    this.exitListeners.add(cb);
    return (): void => {
      this.exitListeners.delete(cb);
    };
  }

  kill(): void {
    if (this.autoRecoveryDebounceTimer !== null) {
      clearTimeout(this.autoRecoveryDebounceTimer);
      this.autoRecoveryDebounceTimer = null;
    }
    if (this.child !== null && !this.child.killed) {
      this.child.kill();
    }
    if (this.cleanupFn !== null) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
  }

  isAlive(): boolean {
    if (this.child === null) return false;
    return !this.child.killed && this.child.exitCode === null;
  }

  getUsage(): UsageEstimate {
    return { ...this.usage };
  }

  getCurrentAction(): string | null {
    return this.currentAction;
  }

  private handleParsedEvent(event: ParsedEvent): void {
    if (event.kind === "turn-complete" && event.usage !== undefined) {
      this.usage.input += event.usage.input;
      this.usage.output += event.usage.output;
      this.usage.cache_creation += event.usage.cache_creation;
      this.usage.cache_read += event.usage.cache_read;
    }
    this.emitEvent(event);
  }

  private emitEvent(event: ParsedEvent): void {
    for (const cb of this.eventListeners) cb(event);
  }

  private emitStderr(line: string): void {
    for (const cb of this.stderrListeners) cb(line);
  }

  private emitExit(code: number | null): void {
    for (const cb of this.exitListeners) cb(code);
  }
}
