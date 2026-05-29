import { describe, it, expect, vi, afterEach } from "vitest";
import { buildChildEnv, buildDerivationArgs, parseRunnerOutput, runDerivation } from "./runner.js";

describe("buildChildEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not inherit a stray host credential — only the intended one survives", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "HOST-STRAY-KEY");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "HOST-STRAY-OAUTH");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "HOST-STRAY-AUTH");
    const env = buildChildEnv({ ANTHROPIC_API_KEY: "INTENDED-KEY" }, "/tmp/cfg");
    // The intended credential wins; the host's stray values never appear.
    expect(env["ANTHROPIC_API_KEY"]).toBe("INTENDED-KEY");
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
    expect(env["ANTHROPIC_AUTH_TOKEN"]).toBeUndefined();
    expect(env["CLAUDE_CONFIG_DIR"]).toBe("/tmp/cfg");
  });

  it("strips a host credential entirely when the derivation passes none", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "HOST-STRAY-KEY");
    const env = buildChildEnv({}, "/tmp/cfg");
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
  });

  it("preserves non-credential host env (e.g. PATH)", () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    const env = buildChildEnv({}, "/tmp/cfg");
    expect(env["PATH"]).toBe("/usr/bin:/bin");
  });
});

describe("buildDerivationArgs", () => {
  it("builds a no-tools print-mode arg list for the given model", () => {
    const args = buildDerivationArgs("claude-sonnet-4-6");
    expect(args).toEqual([
      "-p",
      "--model",
      "claude-sonnet-4-6",
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
    ]);
  });
});

describe("parseRunnerOutput", () => {
  it("extracts text and usage from the result event", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "DISCARD",
        usage: {
          input_tokens: 1200,
          output_tokens: 8,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 400,
        },
      }),
    ].join("\n");
    const out = parseRunnerOutput(stdout);
    expect(out.text).toBe("DISCARD");
    expect(out.usage).toEqual({ input: 1200, output: 8, cacheCreation: 0, cacheRead: 400 });
  });

  it("throws when there is no result event", () => {
    expect(() => parseRunnerOutput(JSON.stringify({ type: "system" }))).toThrow(/result/i);
  });
});

describe("runDerivation", () => {
  it("runs the process and returns parsed text + usage", async () => {
    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "hello",
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
    const calls: Array<{ args: string[]; stdin: string }> = [];
    const out = await runDerivation(
      {
        runProcess: (args, _env, stdin) => {
          calls.push({ args, stdin });
          return Promise.resolve({ stdout: resultLine, exitCode: 0 });
        },
      },
      { prompt: "PROMPT-BODY", model: "claude-sonnet-4-6", env: { X: "y" } },
    );
    expect(out.text).toBe("hello");
    expect(out.usage.input).toBe(10);
    expect(calls[0]?.stdin).toBe("PROMPT-BODY");
    expect(calls[0]?.args).toContain("-p");
  });

  it("throws on a non-zero exit code", async () => {
    await expect(
      runDerivation(
        { runProcess: () => Promise.resolve({ stdout: "", exitCode: 1 }) },
        { prompt: "p", model: "claude-sonnet-4-6", env: {} },
      ),
    ).rejects.toThrow(/exit/i);
  });
});
