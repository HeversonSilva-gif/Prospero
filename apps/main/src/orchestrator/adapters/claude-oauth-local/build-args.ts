import { resolveSkillTools, type Agent } from "@dashboard-agent/shared";
import { buildAgentSystemPrompt } from "../../system-prompt.js";

// We deliberately omit `-p` (--print): that flag makes claude wait for stdin EOF before
// emitting any assistant output, which is incompatible with the persistent runner that
// streams JSONL user messages over time without ever closing stdin. Verified live against
// claude 2.1.138 — without -p, claude streams system/init → assistant → result per turn
// and stays alive for follow-ups.
//
// `--strict-mcp-config` ensures the spawned claude only sees our dashboard MCP server
// and ignores any global MCP servers the host user has configured.
export const buildClaudeArgs = (agent: Agent, mcpConfigPath: string): string[] => {
  const allowedTools = resolveSkillTools(agent.skills);
  const args = [
    "--system-prompt",
    buildAgentSystemPrompt(agent.systemPrompt, agent.skills),
    "--model",
    agent.model,
    "--allowedTools",
    allowedTools.join(","),
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    "--permission-mode",
    "default",
    "--permission-prompt-tool",
    "mcp__dashboard__request_permission",
  ];
  if (agent.claudeSessionId !== null) {
    args.push("--resume", agent.claudeSessionId);
  }
  return args;
};
