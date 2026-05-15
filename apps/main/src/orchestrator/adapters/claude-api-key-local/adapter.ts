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
import { buildClaudeArgs } from "../claude-oauth-local/build-args.js";
import { findClaudeExe } from "../claude-oauth-local/resolve-binary.js";
import { prepareSandbox, writeSandboxSettings } from "../claude-oauth-local/prepare-sandbox.js";
import { parseStreamLine } from "../claude-oauth-local/stream-parser.js";
import { FakeClaude, isFakeClaudeEnabled } from "../claude-oauth-local/fake-claude.js";
import { buildSpawnEnvApiKey } from "../../env.js";
import { setupMcpHandshake } from "../../mcp-handshake.js";
import { mergeSpawnEnv } from "../../util/env-merge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const logFile = resolve(__dirname, "../../orchestrator.log");
const dlog = (msg: string): void => {
  try {
    const logDir = dirname(logFile);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {
    /* ignore log errors */
  }
};

export class ClaudeApiKeyLocalAdapter implements AgentAdapter {
  readonly name: AdapterName = "claude-api-key-local";
  readonly agentId: string;

  private readonly ctx: SpawnContext;
  private child: ChildProcess | null = null;
  private cleanupFn: (() => void) | null = null;
  private currentAction: string | null = null;
  private usage: UsageEstimate = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  private readonly eventListeners = new Set<AdapterEventListener<ParsedEvent>>();
  private readonly stderrListeners = new Set<AdapterEventListener<string>>();
  private readonly exitListeners = new Set<AdapterEventListener<number | null>>();

  constructor(ctx: SpawnContext) {
    this.ctx = ctx;
    this.agentId = ctx.agent.id;
  }

  async start(): Promise<void> {
    if (this.child !== null) {
      throw new Error("Adapter already started; create a new instance to respawn");
    }
    if (this.ctx.apiKey === undefined) {
      throw new Error("claude-api-key-local requires apiKey in SpawnContext");
    }

    const env = buildSpawnEnvApiKey(
      this.ctx.agent,
      this.ctx.apiKey,
      this.ctx.dbPath,
      this.ctx.permissionsDir,
      this.ctx.eventsDir,
    );

    const handshake = setupMcpHandshake(env, this.ctx.mcpServerJsPath);
    const args = buildClaudeArgs(this.ctx.agent, handshake.mcpConfigPath, {
      ...(this.ctx.narratedActive === true ? { narratedActive: true } : {}),
    });

    const { agentConfigDir, agentSandboxCwd, isEphemeralConfigDir } = prepareSandbox(
      this.ctx.agent.id,
      this.ctx.userDataDir,
    );

    // No seedSandboxCredentials — the key flows via env ANTHROPIC_API_KEY.
    writeSandboxSettings(agentConfigDir);

    const spawnCwd = this.ctx.cwd ?? agentSandboxCwd;
    const spawnEnv = mergeSpawnEnv(env, agentConfigDir);

    dlog(`spawn claude (api-key) for agent=${this.ctx.agent.id} cwd=${spawnCwd}`);

    if (isFakeClaudeEnabled()) {
      dlog(`spawn strategy: FakeClaude stub (E2E mode)`);
      this.child = new FakeClaude() as unknown as ChildProcess;
    } else {
      const claudeExe = findClaudeExe();
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

    if (this.child.stdout !== null) {
      const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const parsed = parseStreamLine(line);
        if (parsed !== null) this.handleParsedEvent(parsed);
      });
    }

    if (this.child.stderr !== null) {
      this.child.stderr.setEncoding("utf8");
      this.child.stderr.on("data", (chunk: string) => {
        for (const line of chunk.split("\n")) {
          if (line.trim() !== "") this.emitStderr(line);
        }
      });
    }

    this.child.on("exit", (code) => this.emitExit(code));
    this.child.on("error", (err) => this.emitStderr(`adapter-error: ${err.message}`));

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
    if (this.child === null || this.child.stdin === null || !this.child.stdin.writable) return;
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
    if (this.child !== null && !this.child.killed) this.child.kill();
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
    for (const cb of this.eventListeners) cb(event);
  }
  private emitStderr(line: string): void {
    for (const cb of this.stderrListeners) cb(line);
  }
  private emitExit(code: number | null): void {
    for (const cb of this.exitListeners) cb(code);
  }
}
