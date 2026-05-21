import { spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crossSpawn from "cross-spawn";
import { findClaudeExe } from "../orchestrator/adapters/claude-oauth-local/resolve-binary.js";
import { seedSandboxCredentials } from "../orchestrator/adapters/claude-oauth-local/prepare-sandbox.js";

// Token usage from one derivation run, normalized to the cost layer's shape.
export type DerivationUsage = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
};

export type RunDerivationResult = { text: string; usage: DerivationUsage };

// Injected process I/O — runs `claude` with args + env, feeds stdin, resolves
// the collected stdout and exit code. The real implementation is defaultRunProcess.
export type RunProcess = (
  args: string[],
  env: Record<string, string>,
  stdin: string,
) => Promise<{ stdout: string; exitCode: number }>;

// Print-mode, no-tools arg list. `-p` makes claude read the prompt from stdin,
// emit a stream-json transcript, and exit. `--strict-mcp-config` with no
// `--mcp-config` means zero MCP servers — the derivation prompt needs no tools.
export const buildDerivationArgs = (model: string): string[] => [
  "-p",
  "--model",
  model,
  "--output-format",
  "stream-json",
  "--verbose",
  "--strict-mcp-config",
];

// Picks the final text + usage out of a stream-json transcript: the `result`
// event carries both.
export const parseRunnerOutput = (stdout: string): RunDerivationResult => {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj["type"] !== "result") continue;
    const usage = (obj["usage"] ?? {}) as Record<string, number>;
    return {
      text: typeof obj["result"] === "string" ? obj["result"] : "",
      usage: {
        input: usage["input_tokens"] ?? 0,
        output: usage["output_tokens"] ?? 0,
        cacheCreation: usage["cache_creation_input_tokens"] ?? 0,
        cacheRead: usage["cache_read_input_tokens"] ?? 0,
      },
    };
  }
  throw new Error("derivation runner produced no result event");
};

// The real process I/O: spawn `claude`, write the prompt to stdin, collect stdout.
//
// Auth: OAuth runs get an ephemeral CLAUDE_CONFIG_DIR seeded with the host's live
// credentials file (which carries the long-lived refresh token), so claude rotates
// the short-lived access token itself — exactly as the conversation adapter does.
// Without this the run would rely on a bare CLAUDE_CODE_OAUTH_TOKEN snapshot that
// expires ~1 day after import and silently breaks every background AI feature. The
// merged process.env also gives claude the HOME/PATH it needs to start at all.
// API-key mode needs no credentials file, so it skips the seeding (the empty config
// dir still isolates the run from host hooks/skills/MCP servers).
export const defaultRunProcess: RunProcess = (args, env, stdin) =>
  new Promise((resolve, reject) => {
    const configDir = mkdtempSync(join(tmpdir(), "da-headless-cfg-"));
    if ("CLAUDE_CODE_OAUTH_TOKEN" in env) seedSandboxCredentials(configDir);
    const fullEnv: NodeJS.ProcessEnv = { ...process.env, ...env, CLAUDE_CONFIG_DIR: configDir };
    const cleanup = (): void => {
      try {
        rmSync(configDir, { recursive: true, force: true });
      } catch {
        // best-effort temp cleanup; the OS reclaims tmpdir anyway
      }
    };
    const claudeExe = findClaudeExe();
    const child =
      claudeExe !== null
        ? nodeSpawn(claudeExe, args, {
            env: fullEnv,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          })
        : crossSpawn("claude", args, { env: fullEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    // Drain stderr so a chatty process can never stall on a full pipe buffer.
    child.stderr?.resume();
    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("close", (code) => {
      cleanup();
      resolve({ stdout, exitCode: code ?? 0 });
    });
    child.stdin?.write(stdin);
    child.stdin?.end();
  });

// Runs one headless derivation. Throws on a non-zero exit or unparseable output;
// the worker catches and drops silently (spec §2.1).
export const runDerivation = async (
  deps: { runProcess: RunProcess },
  input: { prompt: string; model: string; env: Record<string, string> },
): Promise<RunDerivationResult> => {
  const { stdout, exitCode } = await deps.runProcess(
    buildDerivationArgs(input.model),
    input.env,
    input.prompt,
  );
  if (exitCode !== 0) {
    throw new Error(`derivation runner exited with code ${exitCode}`);
  }
  return parseRunnerOutput(stdout);
};
