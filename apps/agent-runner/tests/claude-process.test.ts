import { describe, expect, it } from "vitest";
import { spawnClaude } from "../src/claude-process.js";

describe("spawnClaude", () => {
  it("spawns a process and exposes the ClaudeProcess surface", () => {
    // `node -e ""` stands in for the `claude` binary: it exits immediately and
    // has the same stdio/pid/kill/on surface the runner depends on.
    const child = spawnClaude({
      command: process.execPath,
      args: ["-e", ""],
      env: {},
      cwd: process.cwd(),
    });
    expect(typeof child.pid === "number" || child.pid === undefined).toBe(true);
    expect(child.stdin).not.toBeNull();
    expect(child.stdout).not.toBeNull();
    expect(child.stderr).not.toBeNull();
    expect(typeof child.kill).toBe("function");
  });

  it("emits exit when the process finishes", async () => {
    const child = spawnClaude({
      command: process.execPath,
      args: ["-e", ""],
      env: {},
      cwd: process.cwd(),
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on("exit", (c) => resolve(c));
    });
    expect(code).toBe(0);
  });
});
