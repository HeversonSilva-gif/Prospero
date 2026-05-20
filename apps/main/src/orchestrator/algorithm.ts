// "The Algorithm" — the 7-phase operating loop (M13 PR-D, spec §8). Delivered
// exactly like the Operating Manual (M12 PR-B): a compiled constant, exposed
// as an L0 synthetic entry in buildMemoryBlock, body served on demand by the
// skill_read fallback. No DB row. The Algorithm is INSTRUCTION, not a state
// machine — only VERIFY is "hard", and the enforcement for VERIFY lives in
// the verification engine (PR-B1). The hard-to-vary heuristic (§8.4) is
// embedded textually in THINK and VERIFY.

export const ALGORITHM_NAME = "algorithm";

export const ALGORITHM_DESCRIPTION =
  "The 7-phase operating loop — observe, think, plan, build, execute, verify, learn. Run it on any non-trivial issue.";

export const ALGORITHM = `# The Algorithm

When you pick up an issue that is non-trivial — a feature, a fix, a refactor — run the seven phases below. For a trivial chat turn (answering a one-line question, acknowledging a status update), you don't need this; reply directly. This is the project's mode classifier: substantive work runs the loop, conversation doesn't.

The fast version: **observe → think → plan → build → execute → verify → learn**. VERIFY is the hard phase — your work is not done until the criteria pass.

## 1. OBSERVE

Read the issue (title, description, comments). Read the ISA of the goal it belongs to — at minimum the Vision and the criteria your work has to advance. Use \`isa_read({ goal_id })\` to load the full ISA, or \`isa_read({ goal_id, section: "Criteria" })\` if you only need the checklist. Read the memories the prompt surfaced — they are there because they were judged relevant.

Ask: do I understand the problem, and do I know exactly which criteria of the goal this issue is supposed to advance?

## 2. THINK

Form an explanation of what is wrong, or what needs to exist. The quality bar is **hard to vary** — your explanation should be specific enough that changing it would break it. If your explanation would fit any solution, you have not understood the problem yet; go back to OBSERVE.

Write the explanation down — in a comment on the issue, or in the work log — so future readers (and the LEARN phase) can see your reasoning.

## 3. PLAN

Decide concrete steps. For substantial work, propose sub-issues via \`create_issue\` — each sub-issue should be small enough to verify on its own. Check that your steps actually advance the criteria you read in OBSERVE. If they don't, your plan is solving a different problem than the one the goal asked for.

## 4. BUILD

Produce the work — code, doc, design, whatever the issue asks for. Stay inside your sandbox; respect the file fence (you cannot reach outside your working directory, and the gate will block you if you try).

## 5. EXECUTE

Apply or deliver. Record what you produced as artifacts: \`record_artifact({ kind, ref })\`. Artifacts are how others — and the verification engine — see your work. An issue with no artifact looks indistinguishable from no work at all.

## 6. VERIFY — the hard phase

Before you mark the issue \`done\`, call \`criterion_check({ criterion_id })\` on every criterion this issue advances. If any returns \`failed\`, **do not mark done** — fix the work, or, if you genuinely cannot, leave the issue \`in_progress\` with a comment explaining what is blocking you. Mark \`done\` only when every criterion you advance is \`passed\` (or \`waived\` by a human reviewer).

The hard-to-vary heuristic applies again here: can you state, in one sentence, exactly why the work passes each criterion — in a way that would not equally explain a different (wrong) solution? If not, you have not really verified; you have asserted.

The verification engine will re-check everything when the last issue of the goal finishes. Lying or skipping in your auto-check just means the goal bounces back to \`in_progress\` with a louder failure — your auto-check is for you, not against you.

## 7. LEARN

Leave the work log honest: what you tried, what didn't work, what finally did. The derivation pipeline reads these and synthesizes reusable skills for the next agent who hits the same kind of problem — a vague log produces a vague skill; a specific log produces a sharp one.

If a criterion failed more than once before passing, say so explicitly in the log ("the build criterion failed 3 times because of X; fixed by Y") — that is exactly the signal LEARN feeds back into the M11 pipeline.
`;
