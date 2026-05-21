// Sandboxed command execution for verification ISCs (spec §6.3, §17).
// Runs a user-authored command string through the platform shell, in the goal
// owner's sandbox directory, with a minimal (no-secrets) environment and a
// hard timeout. The cwd is fixed by the caller — never taken from the ISC.

import { spawnSync } from "node:child_process";
import crossSpawn from "cross-spawn";

export interface SandboxedCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunSandboxedCommandInput {
  command: string;
  cwd: string;
  timeoutMs: number;
  env: Record<string, string>;
}

// A minimal environment for a verification command: PATH only, plus the
// Windows essentials. No OAuth token, no API key, no cloud credentials.
export const minimalVerificationEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  if (process.env["PATH"] !== undefined) env["PATH"] = process.env["PATH"];
  if (process.env["SystemRoot"] !== undefined) env["SystemRoot"] = process.env["SystemRoot"];
  if (process.env["PATHEXT"] !== undefined) env["PATHEXT"] = process.env["PATHEXT"];
  return env;
};

// Kills the whole process tree of a shell child. `child.kill()` alone only
// terminates the shell and orphans its grandchildren. On Windows taskkill /T
// walks the tree; on POSIX the child is spawned detached (its own process-group
// leader) so killing the negative pid signals the whole group.
const killTree = (child: ReturnType<typeof crossSpawn>): void => {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill();
    return;
  }
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        windowsHide: true,
        timeout: 3000,
      });
    } catch {
      child.kill();
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
};

export const runSandboxedCommand = (
  input: RunSandboxedCommandInput,
): Promise<SandboxedCommandResult> =>
  new Promise((resolve) => {
    // shell: true — `command` is a full shell command line; the args array is
    // empty because the shell parses the whole string.
    const child = crossSpawn(input.command, [], {
      cwd: input.cwd,
      env: input.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // POSIX: own process group so killTree can signal the whole group on
      // timeout (Windows uses taskkill /T instead and keeps default grouping).
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // Even with the whole tree killed, the `close` event can lag or (on a
      // stubborn shell child) not fire at all. Force-resolve after a short
      // grace period so the promise always settles. The exitCode 124 mirrors
      // the POSIX timeout convention.
      graceTimer = setTimeout(() => finish(124), 500);
    }, input.timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    // Spawn errors (e.g. ENOENT) resolve rather than reject — verification
    // callers read exitCode, they do not catch exceptions.
    child.on("error", () => finish(timedOut ? 124 : 1));
    child.on("close", (code) => finish(code ?? (timedOut ? 124 : 1)));
  });
