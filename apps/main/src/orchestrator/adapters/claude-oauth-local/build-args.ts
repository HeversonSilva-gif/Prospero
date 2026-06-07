import { resolveCapabilityTools, applyRunPolicy, type Agent } from "@prospero/shared";
import { composeAgentSystemPrompt } from "../system-prompt-compose.js";

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
    // The capability-boundary prose, pre-built host-side from the company's real
    // connected channels (build-args has no DB access). Audit 2026-06-03 Facet 3
    // C1 — CEO-prompt side. Falls back to the x-only default when absent.
    capabilityBoundary?: string;
    // Onda A #2 (token): true once the company has an approved business plan.
    // The genesis playbook (~4.5 KB) is only needed WHILE the business is being
    // created; after approval it's dead weight on every CEO turn. We drop it only
    // when this is positively true — absent/undefined keeps it (fail-safe: never
    // strip planning guidance during onboarding, incl. the unapproved resubmit
    // loop). Pre-resolved host-side in respawn.ts (build-args has no DB access).
    companyHasApprovedBusiness?: boolean;
  } = {},
): string[] => {
  const allowedTools = applyRunPolicy(resolveCapabilityTools(agent.capabilities), {
    canHire: agent.canHire,
    canAssign: agent.canAssign,
  });
  // The system prompt is composed by the shared pure function so the SDK path
  // (claude-api-direct) produces a byte-identical prompt — guaranteeing the SDK
  // CEO is exactly as smart as the CLI CEO. `opts` here is structurally the
  // ComposeAgentSystemPromptOpts shape (same fields).
  const args = [
    "--system-prompt",
    composeAgentSystemPrompt(agent, opts),
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
