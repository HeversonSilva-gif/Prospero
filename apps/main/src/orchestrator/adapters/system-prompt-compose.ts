import { isCeoAgent, type Agent } from "@prospero/shared";
import { composeSystemPrompt } from "../system-prompt.js";
import { goalsSystemPromptBlock } from "../system-prompt-goals.js";
import { orgArchitectSystemPromptBlock } from "../system-prompt-org.js";
import { buildNarratedBlock } from "../system-prompt-narrated.js";
import { buildGenesisSystemPromptBlock } from "../system-prompt-genesis.js";
import { buildCapabilityBoundary } from "../../agents/genesis/capability-boundary.js";

// Host-side, pre-resolved system-prompt inputs. These are the SAME fields the
// CLI adapters thread through the SpawnContext (narrated/memory/telos/project
// context/capability boundary/approved-business flag). build-args.ts and the
// SDK adapter (claude-api-direct) both pass them here so the CLI CEO and the
// SDK CEO get a byte-identical system prompt.
export type ComposeAgentSystemPromptOpts = {
  narratedActive?: boolean;
  memoryBlock?: string;
  instructionsBlock?: string;
  telosBlock?: string;
  projectContextBlock?: string;
  // The capability-boundary prose, pre-built host-side from the company's real
  // connected channels (no DB access here). Audit 2026-06-03 Facet 3 C1 — CEO-
  // prompt side. Falls back to the x-only default when absent.
  capabilityBoundary?: string;
  // Onda A #2 (token): true once the company has an approved business plan.
  // The genesis playbook (~4.5 KB) is only needed WHILE the business is being
  // created; after approval it's dead weight on every CEO turn. We drop it only
  // when this is positively true — absent/undefined keeps it (fail-safe: never
  // strip planning guidance during onboarding, incl. the unapproved resubmit
  // loop).
  companyHasApprovedBusiness?: boolean;
};

// Pure composer for an agent's system prompt. Extracted from build-args.ts so
// both the CLI path (claude-oauth-local / claude-api-key-local via build-args)
// AND the SDK path (claude-api-direct) build the IDENTICAL prompt — guaranteeing
// the SDK CEO is exactly as smart as the CLI CEO. No I/O, no DB; every dynamic
// input arrives pre-resolved in `opts` (same as the SpawnContext fields).
export const composeAgentSystemPrompt = (
  agent: Agent,
  opts: ComposeAgentSystemPromptOpts = {},
): string => {
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

  return composeSystemPrompt({
    // M12 PR-C: the instruction bundle replaces the legacy system_prompt
    // string. Fall back to system_prompt if the bundle is missing or blank (M1).
    agentPersona,
    capabilities: agent.capabilities,
    // Audit 2026-06-03 Inteligência & Contexto I9: pass the run policy so the
    // prompt's advertised tool list matches the run-policy-filtered
    // --allowedTools computed by build-args (same applyRunPolicy inputs).
    canHire: agent.canHire,
    canAssign: agent.canAssign,
    ...(isCeo
      ? {
          goalsBlock:
            goalsSystemPromptBlock +
            orgArchitectSystemPromptBlock +
            // Onda A #2 (token): the genesis playbook is only needed while the
            // company is being created. Once the business is approved it's ~4.5 KB
            // of dead weight re-read on every CEO turn, so drop it then. We keep it
            // whenever we don't KNOW it's approved (undefined/false) — fail-safe so
            // onboarding (incl. the [BUSINESS_PLAN_FEEDBACK] resubmit loop, where the
            // business is still unapproved) never loses its guidance.
            (opts.companyHasApprovedBusiness === true
              ? ""
              : // The boundary reaches the CEO so it only proposes what the AI can
                // build/run/maintain. Prefer the host-built boundary (grounded in the
                // company's real connectors); fall back to the x-only default when the
                // host didn't pass one. Audit 2026-06-03 Facet 3 C1.
                buildGenesisSystemPromptBlock(
                  opts.capabilityBoundary ?? buildCapabilityBoundary(["x"]),
                )),
        }
      : {}),
    ...(narratedBlock !== undefined ? { narratedBlock } : {}),
    ...(opts.telosBlock !== undefined ? { telosBlock: opts.telosBlock } : {}),
    ...(opts.memoryBlock !== undefined ? { memoryBlock: opts.memoryBlock } : {}),
    ...(opts.projectContextBlock !== undefined
      ? { projectContextBlock: opts.projectContextBlock }
      : {}),
  });
};
