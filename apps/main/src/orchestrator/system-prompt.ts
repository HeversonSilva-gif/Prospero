import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { ensureChatCapability, resolveCapabilityTools, applyRunPolicy } from "@prospero/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try user override first (~/.prospero/preamble.md), then fall back to
// the bundled preamble.md adjacent to this module. tsup copies preamble.md to
// dist/orchestrator/ so __dirname resolution works both in dev (src/) and prod (dist/).
const loadPreamble = (): string => {
  const userOverride = join(homedir(), ".prospero", "preamble.md");
  if (existsSync(userOverride)) {
    return readFileSync(userOverride, "utf8");
  }
  const bundled = resolve(__dirname, "preamble.md");
  return readFileSync(bundled, "utf8");
};

let preambleCache: string | null = null;
const getPreamble = (): string => {
  if (preambleCache === null) preambleCache = loadPreamble();
  return preambleCache;
};

export type ComposeArgs = {
  agentPersona: string;
  capabilities: string[];
  // Audit 2026-06-03 Inteligência & Contexto I9: the run policy that build-args
  // applies to --allowedTools (drops hire/fire/assign when not permitted). The
  // prompt's "visible tools" line MUST reflect the same filtered set, or it
  // promises tools the CLI blocks. Defaults to fully-permissive when omitted so
  // callers that don't gate (tests, back-compat wrapper) see the raw resolution.
  canHire?: boolean;
  canAssign?: boolean;
  role?: { name: string; description: string } | null;
  preambleOverride?: string;
  goalsBlock?: string;
  narratedBlock?: string;
  telosBlock?: string;
  memoryBlock?: string;
  projectContextBlock?: string;
};

export const composeSystemPrompt = (args: ComposeArgs): string => {
  const preamble = args.preambleOverride ?? getPreamble();
  const effectiveCapabilities = ensureChatCapability(args.capabilities);
  // Audit 2026-06-03 Inteligência & Contexto I9: mirror build-args' run-policy
  // filter so the advertised tool list matches the real --allowedTools.
  const resolvedTools = applyRunPolicy(resolveCapabilityTools(args.capabilities), {
    canHire: args.canHire ?? true,
    canAssign: args.canAssign ?? true,
  });

  const roleBlock =
    args.role !== null && args.role !== undefined
      ? `# Your role: ${args.role.name}\n\n${args.role.description}\n\n---\n\n`
      : "";

  const capabilitiesBlock = `
---

# Your capabilities and available tools

You have the following capabilities: ${effectiveCapabilities.join(", ")}.

The host has filtered your visible Claude tools to: ${resolvedTools.join(", ")}.

Tools outside this list are not available to you and will fail if you attempt
to call them. If you need a capability you don't have, ask the user to update
your role.
`;
  const goalsBlock = args.goalsBlock ?? "";
  const narratedBlock = args.narratedBlock ?? "";
  const telosBlock = args.telosBlock ?? "";
  const memoryBlock = args.memoryBlock ?? "";
  const projectContextBlock = args.projectContextBlock ?? "";
  return (
    preamble +
    roleBlock +
    args.agentPersona +
    capabilitiesBlock +
    goalsBlock +
    narratedBlock +
    telosBlock +
    memoryBlock +
    projectContextBlock
  );
};

// Backwards-compatible wrapper used by build-args.ts. Keeps the existing
// 2-arg signature alive so callers don't all need updating at once. New code
// should call composeSystemPrompt directly with the structured args.
export const buildAgentSystemPrompt = (userSystemPrompt: string, capabilities: string[]): string =>
  composeSystemPrompt({ agentPersona: userSystemPrompt, capabilities });
