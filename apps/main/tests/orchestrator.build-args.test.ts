import { describe, expect, it } from "vitest";
import { buildClaudeArgs } from "../src/orchestrator/adapters/claude-oauth-local/build-args.js";
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
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
};

describe("buildClaudeArgs", () => {
  it("includes --model, --mcp-config, --strict-mcp-config and never -p", () => {
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    expect(args).not.toContain("-p");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
    expect(args).toContain("--mcp-config");
    expect(args).toContain("/tmp/mcp.json");
    expect(args).toContain("--strict-mcp-config");
  });

  it("appends --resume when claudeSessionId is not null", () => {
    const args = buildClaudeArgs({ ...baseAgent, claudeSessionId: "session_xyz" }, "/tmp/mcp.json");
    const idx = args.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("session_xyz");
  });

  it("omits --resume when claudeSessionId is null", () => {
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    expect(args).not.toContain("--resume");
  });

  it("omits the MCP triplet when mcpConfigPath is null", () => {
    const args = buildClaudeArgs(baseAgent, null);
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--permission-prompt-tool");
    expect(args).toContain("--model");
    expect(args).toContain("--permission-mode");
  });

  it("drops hire/fire tools from --allowedTools when canHire is false", () => {
    const agent = { ...baseAgent, capabilities: ["delegation", "issues"], canHire: false };
    const args = buildClaudeArgs(agent, "/tmp/mcp.json");
    // Split into the exact tool list — substring checks would false-match
    // hire_agent_for_plan against hire_agent.
    const allowed = args[args.indexOf("--allowedTools") + 1]!.split(",");
    expect(allowed).not.toContain("mcp__dashboard__hire_agent");
    expect(allowed).not.toContain("mcp__dashboard__fire_agent");
    expect(allowed).toContain("mcp__dashboard__message_agent");
    expect(allowed).toContain("mcp__dashboard__assign_issue");
  });

  it("drops assign_issue from --allowedTools when canAssign is false", () => {
    const agent = { ...baseAgent, capabilities: ["delegation", "issues"], canAssign: false };
    const args = buildClaudeArgs(agent, "/tmp/mcp.json");
    const allowed = args[args.indexOf("--allowedTools") + 1]!.split(",");
    expect(allowed).not.toContain("mcp__dashboard__assign_issue");
    expect(allowed).toContain("mcp__dashboard__hire_agent");
  });
});
