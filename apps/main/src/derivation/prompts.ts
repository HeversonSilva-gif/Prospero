import type { IssueTrail, RecoveryTrail } from "./trail.js";

// Shared closing instruction for every derivation prompt. The worker's parser
// (parse-output.ts) understands exactly this contract.
const OUTPUT_CONTRACT = `
Decide whether this work contains a reusable, transferable procedure worth
saving as a skill (a step-by-step "how to" another agent could follow later).

If it does NOT — if it is too trivial, too one-off, or too specific to be
reused — reply with exactly this single word and nothing else:

DISCARD

If it DOES, reply with exactly one fenced JSON block and nothing else:

\`\`\`json
{"name":"kebab-case-skill-name","description":"one line, max 200 chars","body":"markdown steps"}
\`\`\`

Do not add commentary before or after the block.`;

const renderEntries = (entries: Array<{ sender: string; content: string }>): string =>
  entries.length === 0 ? "(none)" : entries.map((e) => `- ${e.sender}: ${e.content}`).join("\n");

// Prompt for a completed-issue derivation.
export const buildIssuePrompt = (trail: IssueTrail): string =>
  `You are reviewing a software task that was just completed, to extract a reusable skill.

## Issue ${trail.identifier}: ${trail.title}

${trail.description}

## Work log (comments, oldest first)

${renderEntries(trail.comments)}
${OUTPUT_CONTRACT}`;

// Prompt for an agent-recovery derivation ("how to avoid the error next time").
export const buildRecoveryPrompt = (trail: RecoveryTrail): string =>
  `You are reviewing how a ${trail.role} agent ("${trail.agentName}") hit an error and then
recovered, to extract a reusable skill about avoiding or fixing that error.

## Recent conversation (oldest first)

${renderEntries(trail.messages)}
${OUTPUT_CONTRACT}`;
