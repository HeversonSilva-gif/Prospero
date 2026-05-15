import { describe, expect, it } from "vitest";
import { buildClaudeArgs, MAX_CONCURRENT_AGENTS } from "../src/orchestrator/lifecycle.js";
import type { Agent } from "@prospero/shared";

const baseAgent: Agent = {
  id: "agent_1",
  companyId: "co_1",
  name: "CEO",
  role: "Chief Executive Officer",
  systemPrompt: "You are CEO.",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
};

describe("buildClaudeArgs", () => {
  it("includes --system-prompt, stream-json IO, --mcp-config — and NOT -p", () => {
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    // -p makes claude wait for stdin EOF; incompatible with our persistent runner.
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--print");
    expect(args).toContain("--system-prompt");
    // The system-prompt value is the user's prompt prepended with the runtime preamble
    // (sandbox + delegation instructions). Assert that the user prompt is included.
    const spIdx = args.indexOf("--system-prompt");
    expect(args[spIdx + 1]).toContain("You are CEO.");
    expect(args).toContain("--input-format");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--mcp-config");
    expect(args).toContain("/tmp/mcp.json");
  });

  it("wires --permission-prompt-tool to dashboard.request_permission (M5 §6.1)", () => {
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    const idx = args.indexOf("--permission-prompt-tool");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("mcp__dashboard__request_permission");
  });

  it("includes --strict-mcp-config to enforce sandbox (regression guard)", () => {
    // Without this flag, the spawned claude inherits the user's globally-configured MCP
    // servers (Slack, Drive, etc.) — sandbox break. Combined with CLAUDE_CONFIG_DIR
    // isolation in spawnAgent, this enforces a real per-agent sandbox.
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    expect(args).toContain("--strict-mcp-config");
  });

  it("does NOT include --resume when claudeSessionId is null", () => {
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    expect(args).not.toContain("--resume");
  });

  it("includes --resume <id> when claudeSessionId is set", () => {
    const args = buildClaudeArgs({ ...baseAgent, claudeSessionId: "sess_xyz" }, "/tmp/mcp.json");
    const idx = args.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("sess_xyz");
  });

  it("never includes the OAuth token in args (regression guard)", () => {
    // Even if a future regression accidentally puts the token in args, this test catches it.
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    for (const a of args) {
      expect(a.includes("sk-ant-oat")).toBe(false);
      expect(a.includes("sk-ant-api")).toBe(false);
    }
  });

  it("includes --model from agent.model (default sonnet)", () => {
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("claude-sonnet-4-6");
  });

  it("respects per-agent model override (e.g. opus)", () => {
    const args = buildClaudeArgs({ ...baseAgent, model: "claude-opus-4-7" }, "/tmp/mcp.json");
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("claude-opus-4-7");
  });

  it("includes --allowedTools resolved from agent.capabilities", () => {
    const args = buildClaudeArgs(
      { ...baseAgent, capabilities: ["shell", "fs-read"] },
      "/tmp/mcp.json",
    );
    const idx = args.indexOf("--allowedTools");
    expect(idx).toBeGreaterThan(-1);
    const value = args[idx + 1]!;
    const tools = value.split(",");
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
    expect(tools).toContain("mcp__dashboard__request_permission");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
  });

  it("auto-injects chat capability when missing from agent.capabilities", () => {
    const args = buildClaudeArgs({ ...baseAgent, capabilities: ["shell"] }, "/tmp/mcp.json");
    const idx = args.indexOf("--allowedTools");
    const tools = args[idx + 1]!.split(",");
    expect(tools).toContain("mcp__dashboard__request_permission");
  });

  it("falls back to chat-only when capabilities array is empty", () => {
    const args = buildClaudeArgs({ ...baseAgent, capabilities: [] }, "/tmp/mcp.json");
    const idx = args.indexOf("--allowedTools");
    const tools = args[idx + 1]!.split(",");
    expect(tools).toEqual(["mcp__dashboard__request_permission"]);
  });
});

describe("lifecycle constants", () => {
  it("MAX_CONCURRENT_AGENTS is 4", () => {
    expect(MAX_CONCURRENT_AGENTS).toBe(4);
  });
});
