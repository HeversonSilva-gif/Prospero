// Sandboxed command execution for verification ISCs (spec §6.3, §17).
// Runs a user-authored command string through the platform shell, in the goal
// owner's sandbox directory, with a minimal (no-secrets) environment and a
// hard timeout. The cwd is fixed by the caller — never taken from the ISC.

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

export const runSandboxedCommand = (
  input: RunSandboxedCommandInput,
): Promise<SandboxedCommandResult> =>
  new Promise((resolve) => {
    const child = crossSpawn(input.command, [], {
      cwd: input.cwd,
      env: input.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // On Windows with shell:true the shell (cmd.exe) is killed but the
      // grandchild node process may keep running, so the `close` event never
      // fires. Force-resolve after a short grace period so the promise always
      // settles. The exitCode 124 mirrors the POSIX timeout convention.
      setTimeout(() => finish(124), 500);
    }, input.timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };
    child.on("error", () => finish(timedOut ? 124 : 1));
    child.on("close", (code) => finish(code ?? (timedOut ? 124 : 1)));
  });
