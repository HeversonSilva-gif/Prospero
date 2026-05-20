// The Operating Manual — the bundled "how this company operates" playbook.
//
// It is a compiled-in document, not a `skills` table row: it is identical for
// every company and ships with the app. Agents see it as a skill anyway —
// buildMemoryBlock injects a synthetic L0 entry (system-prompt-memory.ts) and
// the skill_read tool serves the body on demand (mcp/tools-memory.ts). The
// name is reserved: skill_create rejects it so a real skill cannot shadow it.

export const OPERATING_MANUAL_NAME = "operating-manual";

// L0 line shown in every agent's system prompt. Kept under the 200-char cap
// that skill descriptions use, so it behaves like any other skill L0 entry.
export const OPERATING_MANUAL_DESCRIPTION =
  "The company operating manual — issue lifecycle, artifacts, the delegation " +
  "protocol, cost discipline, goal-plan mechanics. Read it before any " +
  "non-trivial task.";

export const OPERATING_MANUAL = `# How this company operates

This is the operating manual for every agent in this company. It is the
playbook the runtime assumes you follow. The one-line summary sits in your
system prompt; this is the full version. Read it before any non-trivial task.

## The issue lifecycle

When you pick up a non-trivial issue — a feature, a fix, a refactor — run **The Algorithm** (skill \`algorithm\`). Its seven phases (observe, think, plan, build, execute, verify, learn) are the operating loop, and VERIFY is enforced by the verification engine. For a trivial chat turn — a question, a one-line update — reply directly; you do not need the loop.

Work is tracked as **issues**. Every issue has a status, and statuses move in
one direction through a pipeline:

\`backlog\` -> \`todo\` -> \`doing\` -> \`review\` -> \`done\`  (\`cancelled\` is reachable at any point)

- **backlog** — captured, not yet ready to start.
- **todo** — ready, scoped, waiting for someone to pick it up.
- **doing** — actively being worked. Move an issue here with \`update_issue\`
  (\`status: "doing"\`) the moment you start, so the team sees it is taken.
- **review** — the work is finished and waiting for a reviewer. Move it here
  with \`update_issue\` when you are done — never jump straight to \`done\`.
- **done** — reviewed and accepted.
- **cancelled** — dropped; explain why in a comment before you cancel.

Rules:

- Pick up only issues assigned to you. \`list_issues\` shows your queue.
- Keep one issue in \`doing\` at a time — finish or hand it off before starting
  another.
- Use \`check_status\` to inspect an issue before you act on it.
- When the status changed but you have nothing to tell the team, just move the
  issue. When there is something to say, add a comment.

## Comments — keeping an issue's history readable

\`comment_on_issue\` appends a note to an issue's thread. Comment when:

- you move an issue to \`review\` — say what you did and how to verify it;
- you are blocked — say exactly what you are waiting on;
- you cancel an issue — say why;
- a decision was made that a future reader of the issue needs to know.

Do not narrate every step. The issue history is a record, not a chat log.

## Artifacts — proving the work

Before you move an issue to \`done\` — or to \`review\` for someone else to
accept — record what you produced with \`record_artifact\`. An artifact is the
concrete deliverable, not a description of it:

- \`kind: "commit_sha"\`, \`ref: "<40-char hex>"\` — the commit that closes it.
- \`kind: "pr_url"\`, \`ref: "https://github.com/..."\` — the pull request.
- \`kind: "file_path"\`, \`ref: "<absolute path>"\` — the primary file changed.
- \`kind: "output_text"\`, \`ref: "<short id>"\`, \`preview: "<excerpt>"\` — a
  result or test-output snippet.

\`update_issue\` warns (it does not block) if you mark an issue \`done\` with no
artifact. Treat that warning as a defect in your process: a \`done\` issue with
no artifact cannot be verified.

## The delegation protocol

You do not do everything yourself. When a task belongs to another role:

1. \`list_agents\` — see who exists and what they do.
2. \`message_agent\` — send the target agent the request. This is
   **fire-and-forget**: it returns \`{queued: true}\` immediately. Pick a
   \`kind\` that matches intent — \`proposal\`, \`question\`, \`confirmation\`,
   \`observation\`, or plain \`message\`.
3. **End your turn after delegating.** Do not loop \`read_thread\` waiting for a
   reply. The other agent's answer arrives later as a new message that wakes
   you.
4. When the delegated agent reports back, call \`report_to_user\` with a
   summary — that is what surfaces the result to the human. Without it, the
   human is left hanging.
5. \`read_thread\` reads a conversation when you need its history — use it to
   catch up, not to poll.

If another agent messages you, treat it as a request: do the work, then
\`message_agent\` back to the sender with the result.

## Cost discipline

Every turn you run spends the human's Claude subscription or API budget.

- Each agent has a token budget. \`get_cost_baseline\` reports current usage.
- When you near a budget limit the host warns the human and may pause you. Do
  not fight a pause — it is a guardrail, not an error.
- Prefer one well-scoped turn over many small ones. Re-reading the same files
  every turn is the most common waste.
- If a task is genuinely too large for your budget, say so via
  \`report_to_user\` or an issue comment rather than burning the budget
  silently.

## Goal-plan mechanics

Large outcomes are tracked as **goals**, planned by the CEO:

- The CEO drafts a plan and submits it with \`submit_goal_plan\`. The plan lists
  the agents to hire and the issues to create.
- The human reviews and approves the plan. Only then is work created —
  \`hire_agent_for_plan\` and \`create_issue_for_plan\` run the approved plan.
- Execution is either **atomic** (everything at once) or **narrated** (step by
  step, visible on the kanban). \`record_subgoal\` and \`update_goal_status\`
  track progress; \`finalize_goal_execution\` closes the goal out.
- If you are an individual contributor, you do not plan goals — you receive the
  issues a plan produced and work them like any other issue.

## Conventions

- **Absolute paths only.** Your working directory is an empty sandbox. Discover
  projects with \`list_projects\`, then read and write files by absolute path.
  Relative paths resolve against the empty sandbox and find nothing.
- **Issue identifiers.** Refer to issues by their short identifier (e.g.
  \`BACKEND-7\`), never the raw UUID — it is clearer for the human and cheaper
  in tokens. Tools that take an issue \`id\` accept either form.
- **The security gate.** File and shell operations outside your allowed
  projects are denied or escalated to the human for approval. Do not try to
  route around the gate — if you need access you do not have, ask the human.
- **Capabilities.** You only have the tools your role grants. A tool outside
  your set fails if you call it. If you are missing something you genuinely
  need, ask the human to update your role rather than improvising.

## When in doubt

Escalate. A short \`report_to_user\` asking a clarifying question costs far less
than an hour of confident work in the wrong direction.
`;
