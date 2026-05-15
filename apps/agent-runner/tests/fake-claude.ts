import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ClaudeProcess } from "../src/claude-process.js";

/**
 * A test-controllable ClaudeProcess. The test drives stdout/stderr/exit by hand
 * and inspects what the runner wrote to stdin.
 */
export class FakeClaude extends EventEmitter implements ClaudeProcess {
  readonly pid = 4242;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly stdinWrites: string[] = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => this.stdinWrites.push(chunk.toString()));
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.emit("exit", 0);
  }

  /** Test helper: push a chunk to the child's stdout. */
  emitStdout(chunk: string): void {
    this.stdout.write(chunk);
  }

  /** Test helper: push a chunk to the child's stderr. */
  emitStderr(chunk: string): void {
    this.stderr.write(chunk);
  }

  /** Test helper: end the process with an exit code. */
  emitExit(code: number | null): void {
    this.emit("exit", code);
  }
}
