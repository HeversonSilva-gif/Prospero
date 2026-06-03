import { resolveCapabilityTools, applyRunPolicy, isCeoAgent, type Agent } from "@prospero/shared";
import { composeSystemPrompt } from "../../system-prompt.js";
import { goalsSystemPromptBlock } from "../../system-prompt-goals.js";
import { orgArchitectSystemPromptBlock } from "../../system-prompt-org.js";
import { buildNarratedBlock } from "../../system-prompt-narrated.js";
import { buildGenesisSystemPromptBlock } from "../../system-prompt-genesis.js";
import { buildCapabilityBoundary } from "../../../agents/genesis/capability-boundary.js";

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
  } = {},
): string[] => {
  const allowedTools = applyRunPolicy(resolveCapabilityTools(agent.capabilities), {
    canHire: agent.canHire,
    canAssign: agent.canAssign,
  });
  const isCeo = isCeoAgent(agent);
  const narratedBlock = opts.narratedActive === true ? buildNarratedBlock() : undefined;
  // Audit 2026-06-03 Inteligência & Contexto M1: composeInstructions can return
  // "" when the bundle exists but is blank, so `?? agent.systemPrompt` does NOT
  // fall back (?? only catches undefined). Fall back when undefined OR blank so
  // the agent never runs with an empty persona.
  const agentPersona =
    opts.instructionsBlock !== undefined && opts.instructionsBlock.trim() !== ""
      ? opts.instructionsBlock
      : agent.systemPrompt;
  const args = [
    "--system-prompt",
    composeSystemPrompt({
      // M12 PR-C: the instruction bundle replaces the legacy system_prompt
      // string. Fall back to system_prompt if the bundle is missing or blank (M1).
      agentPersona,
      capabilities: agent.capabilities,
      // Audit 2026-06-03 Inteligência & Contexto I9: pass the run policy so the
      // prompt's advertised tool list matches the run-policy-filtered
      // --allowedTools computed above (same applyRunPolicy inputs).
      canHire: agent.canHire,
      canAssign: agent.canAssign,
      ...(isCeo
        ? {
            goalsBlock:
              goalsSystemPromptBlock +
              orgArchitectSystemPromptBlock +
              // The boundary reaches the CEO so it only proposes what the AI
              // can build/run/maintain. Prefer the host-built boundary (grounded
              // in the company's real connectors); fall back to the x-only
              // default when the host didn't pass one. Audit 2026-06-03 Facet 3 C1.
              buildGenesisSystemPromptBlock(
                opts.capabilityBoundary ?? buildCapabilityBoundary(["x"]),
              ),
          }
        : {}),
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
