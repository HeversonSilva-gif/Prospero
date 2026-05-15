import { resolveSkillTools, type Agent } from "@prospero/shared";
import { composeSystemPrompt } from "../../system-prompt.js";
import { goalsSystemPromptBlock } from "../../system-prompt-goals.js";
import { buildNarratedBlock } from "../../system-prompt-narrated.js";

// We deliberately omit `-p` (--print): that flag makes claude wait for stdin EOF before
// emitting any assistant output, which is incompatible with the persistent runner that
// streams JSONL user messages over time without ever closing stdin. Verified live against
// claude 2.1.138 — without -p, claude streams system/init → assistant → result per turn
// and stays alive for follow-ups.
//
// `--strict-mcp-config` ensures the spawned claude only sees our dashboard MCP server
// and ignores any global MCP servers the host user has configured.
export const buildClaudeArgs = (
  agent: Agent,
  mcpConfigPath: string | null,
  opts: { narratedActive?: boolean } = {},
): string[] => {
  const allowedTools = resolveSkillTools(agent.skills);
  const isCeo = agent.role === "ceo" || agent.role === "CEO";
  const narratedBlock = opts.narratedActive === true ? buildNarratedBlock() : undefined;
  const args = [
    "--system-prompt",
    composeSystemPrompt({
      agentPersona: agent.systemPrompt,
      skills: agent.skills,
      ...(isCeo ? { goalsBlock: goalsSystemPromptBlock } : {}),
      ...(narratedBlock !== undefined ? { narratedBlock } : {}),
    }),
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
    "--permission-mode",
    "default",
  ];
  // The MCP triplet — host-side adapters pass a host mcp.json path; the remote
  // adapter passes null because the agent-runner appends the triplet itself with
  // the container-local mcp.json path (m10 design §4.3 / §6).
  if (mcpConfigPath !== null) {
    args.push(
      "--mcp-config",
      mcpConfigPath,
      "--strict-mcp-config",
      "--permission-prompt-tool",
      "mcp__dashboard__request_permission",
    );
  }
  if (agent.claudeSessionId !== null) {
    args.push("--resume", agent.claudeSessionId);
  }
  return args;
};
