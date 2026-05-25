import { resolveCapabilityTools, applyRunPolicy, isCeoAgent, type Agent } from "@prospero/shared";
import { composeSystemPrompt } from "../../system-prompt.js";
import { goalsSystemPromptBlock } from "../../system-prompt-goals.js";
import { orgArchitectSystemPromptBlock } from "../../system-prompt-org.js";
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
  opts: {
    narratedActive?: boolean;
    memoryBlock?: string;
    instructionsBlock?: string;
    telosBlock?: string;
    projectContextBlock?: string;
  } = {},
): string[] => {
  const allowedTools = applyRunPolicy(resolveCapabilityTools(agent.capabilities), {
    canHire: agent.canHire,
    canAssign: agent.canAssign,
  });
  const isCeo = isCeoAgent(agent);
  const narratedBlock = opts.narratedActive === true ? buildNarratedBlock() : undefined;
  const args = [
    "--system-prompt",
    composeSystemPrompt({
      // M12 PR-C: the instruction bundle replaces the legacy system_prompt
      // string. Fall back to system_prompt if the host did not pass a bundle.
      agentPersona: opts.instructionsBlock ?? agent.systemPrompt,
      capabilities: agent.capabilities,
      ...(isCeo ? { goalsBlock: goalsSystemPromptBlock + orgArchitectSystemPromptBlock } : {}),
      ...(narratedBlock !== undefined ? { narratedBlock } : {}),
      ...(opts.telosBlock !== undefined ? { telosBlock: opts.telosBlock } : {}),
      ...(opts.memoryBlock !== undefined ? { memoryBlock: opts.memoryBlock } : {}),
      ...(opts.projectContextBlock !== undefined
        ? { projectContextBlock: opts.projectContextBlock }
        : {}),
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
    // Disable interactive Claude built-ins the dashboard can't render. The CEO
    // called AskUserQuestion to ask a multiple-choice question and then waited
    // forever for an answer the conversation UI never showed. Without these, the
    // agent asks clarifying questions as normal chat messages (which we render)
    // and plan/subagent modes don't strand the turn.
    "--disallowedTools",
    "AskUserQuestion,Task,EnterPlanMode,ExitPlanMode",
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
