import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** The subset of node:child_process.ChildProcess the runner depends on. */
export type ClaudeProcess = {
  // Optional + `| undefined` so node's ChildProcess (pid?: number | undefined)
  // is assignable under exactOptionalPropertyTypes.
  readonly pid?: number | undefined;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(): void;
  on(event: "exit", listener: (code: number | null) => void): void;
};

export type ClaudeSpawnOptions = {
  /** Binary to run — "claude" in the container; overridable for tests. */
  command: string;
  args: string[];
  /** Extra env merged over the runner's own process.env. */
  env: Record<string, string>;
  cwd: string;
};

/** Spawns a child process. Injectable so tests can substitute a FakeClaude. */
export type ClaudeSpawner = (opts: ClaudeSpawnOptions) => ClaudeProcess;

/** The production spawner — runs the real binary with piped stdio. */
export const spawnClaude: ClaudeSpawner = (opts) =>
  spawn(opts.command, opts.args, {
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
