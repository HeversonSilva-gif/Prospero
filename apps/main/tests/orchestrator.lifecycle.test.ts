import { describe, expect, it, beforeEach } from "vitest";
import {
  buildClaudeArgs,
  registerRunner,
  removeRunner,
  getRunner,
  activeRunnerCount,
  MAX_CONCURRENT_AGENTS,
  type AgentRunner,
} from "../src/orchestrator/lifecycle.js";
import type { Agent } from "@dashboard-agent/shared";

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
};

const fakeRunner = (id: string, alive: boolean): AgentRunner => ({
  agentId: id,
  send: () => undefined,
  kill: () => undefined,
  isAlive: () => alive,
});

describe("buildClaudeArgs", () => {
  it("includes --system-prompt, stream-json IO, --mcp-config — and NOT -p", () => {
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    // -p makes claude wait for stdin EOF; incompatible with our persistent runner.
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--print");
    expect(args).toContain("--system-prompt");
    expect(args).toContain("You are CEO.");
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
});

describe("runner registry", () => {
  beforeEach(() => {
    // clean registry between tests
    for (let i = 0; i < 10; i++) removeRunner(`agent_${String(i)}`);
  });

  it("register + get + remove", () => {
    const r = fakeRunner("agent_a", true);
    registerRunner(r);
    expect(getRunner("agent_a")).toBe(r);
    removeRunner("agent_a");
    expect(getRunner("agent_a")).toBeUndefined();
  });

  it("activeRunnerCount counts alive runners only", () => {
    registerRunner(fakeRunner("agent_x", true));
    registerRunner(fakeRunner("agent_y", false));
    registerRunner(fakeRunner("agent_z", true));
    expect(activeRunnerCount()).toBe(2);
    removeRunner("agent_x");
    removeRunner("agent_y");
    removeRunner("agent_z");
  });

  it("MAX_CONCURRENT_AGENTS is 4", () => {
    expect(MAX_CONCURRENT_AGENTS).toBe(4);
  });
});
