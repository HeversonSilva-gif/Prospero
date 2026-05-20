import type {
  IssueTrail,
  RecoveryTrail,
  GoalTrail,
  ApprovalTrail,
  TrailCriterion,
} from "./trail.js";

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

const renderCriterionLine = (c: TrailCriterion): string => {
  const verdict =
    c.status === "passed" && c.attempts === 1
      ? "passed first try"
      : c.status === "passed" && c.attempts > 1
        ? `passed after ${c.attempts} attempts`
        : c.status === "failed" && c.attempts > 1
          ? `still failing after ${c.attempts} attempts`
          : c.status === "failed"
            ? "failed"
            : c.status === "waived"
              ? "waived"
              : "not yet checked";
  return `- [${c.kind}] ${c.statement} — ${verdict}`;
};

const renderCriteriaSection = (criteria: TrailCriterion[]): string => {
  if (criteria.length === 0) return "";
  return `\n\n## Criteria status\n\n${criteria.map(renderCriterionLine).join("\n")}`;
};

// Prompt for a completed-issue derivation.
export const buildIssuePrompt = (trail: IssueTrail): string =>
  `You are reviewing a software task that was just completed, to extract a reusable skill.

## Issue ${trail.identifier}: ${trail.title}

${trail.description}

## Work log (comments, oldest first)

${renderEntries(trail.comments)}${renderCriteriaSection(trail.criteria)}
${OUTPUT_CONTRACT}`;

// Prompt for an agent-recovery derivation ("how to avoid the error next time").
export const buildRecoveryPrompt = (trail: RecoveryTrail): string =>
  `You are reviewing how a ${trail.role} agent ("${trail.agentName}") hit an error and then
recovered, to extract a reusable skill about avoiding or fixing that error.

## Recent conversation (oldest first)

${renderEntries(trail.messages)}
${OUTPUT_CONTRACT}`;

// Closing instruction for memory derivations (retrospective / preference).
// The worker's parser (parseMemoryDerivation) understands exactly this contract.
const MEMORY_OUTPUT_CONTRACT = `
If there is nothing durable and reusable worth remembering, reply with exactly
this single word and nothing else:

DISCARD

Otherwise reply with exactly one fenced JSON block and nothing else — one or two
sentences, factual, max 500 characters:

\`\`\`json
{"body":"the durable fact, in one or two sentences"}
\`\`\`

Do not add commentary before or after the block.`;

// Prompt for a `goal.achieved` retrospective — a company-level lesson.
export const buildRetrospectivePrompt = (trail: GoalTrail): string =>
  `A company just achieved a goal. Write a brief retrospective — the one durable
lesson worth remembering company-wide for next time.

## Goal: ${trail.title}

${trail.description}

Success criteria: ${trail.successCriteria}

## Issues done for this goal

${
  trail.issues.length === 0
    ? "(none)"
    : trail.issues.map((i) => `- [${i.status}] ${i.title}`).join("\n")
}${renderCriteriaSection(trail.criteria)}
${MEMORY_OUTPUT_CONTRACT}`;

// Prompt for an `approval.rejected` preference — what the user does NOT want.
export const buildPreferencePrompt = (trail: ApprovalTrail): string =>
  `The user just REJECTED an action an agent asked to perform. Capture the
user's preference as a short durable rule, so agents avoid this next time.

## Rejected action (kind: ${trail.kind})

${trail.payloadJson}

## The user's reason

${trail.note === "" ? "(none given)" : trail.note}
${MEMORY_OUTPUT_CONTRACT}`;
