# M12 PR-B — Operating Manual & Operational Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the **Operating Manual** — a single bundled playbook for "how this company operates" — so every agent gets it as a progressive-disclosure skill (one-line L0 entry in the prompt, full body on demand), and add a pointer to it from the core operational contract (`preamble.md`).

**Architecture:** The Operating Manual is a **compiled-in constant** (`apps/main/src/orchestrator/operating-manual.ts`), not a `skills` table row. `buildMemoryBlock` injects a synthetic L0 entry for it into every agent's `## Your skills` block. `skill_read` serves its body via a fallback when no DB row matches the reserved name; `skill_search` surfaces it; `skill_create` rejects the reserved name. **No migration, no DB rows, no per-company seeding** — the Manual ships and updates with the app. (This is the embedded-document option from the M12 design doc §16; the doc's "DB row + `source='bundled'`" framing was an open decision and is intentionally not taken — a per-company row for an identical shipped document adds a table-recreation migration, lazy seeding, and file-staleness handling for no behavioural gain.)

**Tech Stack:** Electron + TypeScript, vitest. Touches `apps/main` only — orchestrator (`system-prompt-memory.ts`), MCP tools (`tools-memory.ts`), `preamble.md`. No shared/renderer/DB changes.

**Scope note — the operational contract (design doc §2a):** the existing `preamble.md` already covers delegation, the issue identifier convention, absolute-path discipline, message kinds, artifacts, and names the security gate. It already *is* the concise core contract §2a calls for. PR-B's only change to it is appending a pointer to the new Operating Manual skill. A wholesale preamble rewrite is out of scope (it has user-override semantics via `~/.prospero/preamble.md` and would be churn for no gain).

**Pre-verified facts (from codebase exploration):**
- `skill_read` already resolves company-shared skills by name (`getByName(companyId, agentId, name) ?? getByName(companyId, null, name)`), so the fallback slots cleanly into its existing `null` branch.
- The `memory` capability — which exposes `skill_read`/`skill_search` — is force-added to **every** agent (`ensureMemoryCapability` in `packages/shared/src/capabilities.ts`). The Manual is therefore readable by every agent.
- Skill `trust` is never auto-decayed (`maintenance.ts` only decays *memory importance*). No L0-dropout risk.
- `buildMemoryBlock` is called unconditionally at every spawn (`orchestrator-handlers.ts:293`).

**Targeted test runs:** `pnpm --filter @prospero/main exec vitest run <file>` (fast, skips the native-rebuild prehook — already built this session). Full suite at the end: `pnpm test`.

---

## File Structure

**Created:**
- `apps/main/src/orchestrator/operating-manual.ts` — `OPERATING_MANUAL` body + `OPERATING_MANUAL_NAME` + `OPERATING_MANUAL_DESCRIPTION` (the L0 line).
- `apps/main/src/orchestrator/operating-manual.test.ts` — content/shape tests.

**Modified:**
- `apps/main/src/orchestrator/system-prompt-memory.ts` — `buildMemoryBlock` injects the synthetic Manual L0 entry; the `## Your skills` section now always renders.
- `apps/main/src/orchestrator/system-prompt-memory.test.ts` — replace the "returns undefined when empty" test.
- `apps/main/src/mcp/tools-memory.ts` — `skill_read` fallback, `skill_search` surfacing, `skill_create` reserved-name guard.
- `apps/main/src/mcp/tools-memory.test.ts` — three new tests.
- `apps/main/src/orchestrator/preamble.md` — append the Operating Manual pointer section.
- `docs/skills-format.md` — document the bundled Operating Manual + reserved name.

---

## Task 1: The `operating-manual.ts` module

**Files:**
- Create: `apps/main/src/orchestrator/operating-manual.ts`
- Create: `apps/main/src/orchestrator/operating-manual.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/orchestrator/operating-manual.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  OPERATING_MANUAL,
  OPERATING_MANUAL_NAME,
  OPERATING_MANUAL_DESCRIPTION,
} from "./operating-manual.js";

describe("operating-manual", () => {
  it("has a kebab-case name", () => {
    expect(OPERATING_MANUAL_NAME).toMatch(/^[a-z0-9-]+$/);
  });

  it("has an L0 description within the 200-char skill description cap", () => {
    expect(OPERATING_MANUAL_DESCRIPTION.length).toBeGreaterThan(0);
    expect(OPERATING_MANUAL_DESCRIPTION.length).toBeLessThanOrEqual(200);
  });

  it("ships a substantial body covering every core section", () => {
    expect(OPERATING_MANUAL.length).toBeGreaterThan(1024);
    for (const heading of [
      "issue lifecycle",
      "artifacts",
      "delegation protocol",
      "cost discipline",
      "goal-plan mechanics",
      "conventions",
    ]) {
      expect(OPERATING_MANUAL.toLowerCase()).toContain(heading);
    }
  });

  it("body stays under the 16 KB skill_read body cap", () => {
    expect(OPERATING_MANUAL.length).toBeLessThanOrEqual(16_384);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/operating-manual.test.ts`
Expected: FAIL — `Cannot find module './operating-manual.js'`.

- [ ] **Step 3: Create `apps/main/src/orchestrator/operating-manual.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/operating-manual.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/operating-manual.ts apps/main/src/orchestrator/operating-manual.test.ts
git commit -m "feat(manual): add the bundled operating manual document"
```

---

## Task 2: Inject the Operating Manual L0 entry in `buildMemoryBlock`

**Files:**
- Modify: `apps/main/src/orchestrator/system-prompt-memory.ts`
- Modify: `apps/main/src/orchestrator/system-prompt-memory.test.ts`

- [ ] **Step 1: Update the failing test**

In `apps/main/src/orchestrator/system-prompt-memory.test.ts`, replace this test:

```ts
  it("returns undefined when there is nothing to inject", () => {
    expect(buildMemoryBlock(deps(s))).toBeUndefined();
  });
```

with:

```ts
  it("always includes the operating manual, even with no memory or skills", () => {
    const block = buildMemoryBlock(deps(s)) ?? "";
    expect(block).toContain("## Your skills");
    expect(block).toContain("operating-manual");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/system-prompt-memory.test.ts -t "always includes the operating manual"`
Expected: FAIL — `block` is `""` (current `buildMemoryBlock` returns `undefined` when empty), so `toContain` fails.

- [ ] **Step 3: Add the import to `system-prompt-memory.ts`**

In `apps/main/src/orchestrator/system-prompt-memory.ts`, add after the existing `getUserMemoryPath` import line:

```ts
import { OPERATING_MANUAL_NAME, OPERATING_MANUAL_DESCRIPTION } from "./operating-manual.js";
```

- [ ] **Step 4: Replace the skills section in `buildMemoryBlock`**

In `apps/main/src/orchestrator/system-prompt-memory.ts`, replace this block:

```ts
  const skills = renderSkills(
    [
      ...deps.skillsRepo.listByAgent(deps.agentId),
      ...deps.skillsRepo.listForRole(deps.companyId, deps.role),
      ...deps.skillsRepo.listCompanyGlobal(deps.companyId),
    ],
    SKILLS_CAP,
  );
  if (skills.length > 0) {
    sections.push(
      `## Your skills\n\nYou have these skills (procedural know-how). Use skill_read to load one:\n\n${skills.trimEnd()}`,
    );
  }

  if (sections.length === 0) return undefined;
```

with:

```ts
  const dbSkills = renderSkills(
    [
      ...deps.skillsRepo.listByAgent(deps.agentId),
      ...deps.skillsRepo.listForRole(deps.companyId, deps.role),
      ...deps.skillsRepo.listCompanyGlobal(deps.companyId),
    ],
    SKILLS_CAP,
  );
  // The operating manual is a bundled skill every agent always has. It is a
  // synthetic L0 entry — no DB row — whose body the skill_read fallback serves
  // on demand (see mcp/tools-memory.ts). Listed first so the budget cannot
  // crowd it out. The skills section therefore always renders.
  const manualLine = `- ${OPERATING_MANUAL_NAME}: ${OPERATING_MANUAL_DESCRIPTION}\n`;
  sections.push(
    `## Your skills\n\nYou have these skills (procedural know-how). Use skill_read to load one:\n\n${(
      manualLine + dbSkills
    ).trimEnd()}`,
  );

  if (sections.length === 0) return undefined;
```

(The final `if (sections.length === 0) return undefined;` is now unreachable — the skills section always pushes — but is left in place as a harmless guard so the function signature and caller in `orchestrator-handlers.ts` are unchanged.)

- [ ] **Step 5: Run the full file's tests to verify they pass**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/system-prompt-memory.test.ts`
Expected: PASS — all tests, including the rewritten one. The "caps each section", "sorts skill L0", and skill/memory-content tests still pass: the manual line is an additive prefix to the skills section and does not disturb memory sections or relative skill order.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/orchestrator/system-prompt-memory.ts apps/main/src/orchestrator/system-prompt-memory.test.ts
git commit -m "feat(manual): inject the operating manual as a skill L0 entry"
```

---

## Task 3: `skill_read` fallback, `skill_search` surfacing, `skill_create` guard

**Files:**
- Modify: `apps/main/src/mcp/tools-memory.ts`
- Modify: `apps/main/src/mcp/tools-memory.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/main/src/mcp/tools-memory.test.ts`, add these three tests inside the `describe("skill tools", ...)` block (after the existing skill tests, before the block closes):

```ts
  it("skill_read serves the bundled operating manual with no DB row", async () => {
    const out = JSON.parse(
      await tool("skill_read").run({ name: "operating-manual" }, ctx),
    ) as { name: string; body: string };
    expect(out.name).toBe("operating-manual");
    expect(out.body.toLowerCase()).toContain("issue lifecycle");
  });

  it("skill_create rejects the reserved operating-manual name", async () => {
    await expect(
      tool("skill_create").run({ name: "operating-manual", description: "x", body: "y" }, ctx),
    ).rejects.toThrow(/reserved/i);
  });

  it("skill_search surfaces the operating manual when the query matches", async () => {
    const out = JSON.parse(
      await tool("skill_search").run({ query: "operating" }, ctx),
    ) as { skills: Array<{ name: string }> };
    expect(out.skills.some((sk) => sk.name === "operating-manual")).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @prospero/main exec vitest run src/mcp/tools-memory.test.ts -t "operating"`
Expected: FAIL — `skill_read` throws `skill not found: operating-manual`; `skill_create` resolves instead of rejecting; `skill_search` returns no match.

- [ ] **Step 3: Add the import to `tools-memory.ts`**

In `apps/main/src/mcp/tools-memory.ts`, add after the existing `import { createRateLimiter } from "./rate-limiter.js";` line:

```ts
import {
  OPERATING_MANUAL,
  OPERATING_MANUAL_NAME,
  OPERATING_MANUAL_DESCRIPTION,
} from "../orchestrator/operating-manual.js";
```

- [ ] **Step 4: Add the `skill_search` surfacing**

In `tools-memory.ts`, in `skillSearch.run`, replace:

```ts
    const skills = pool
      .filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        shared: s.agentId === null,
      }));
    return JSON.stringify({ skills });
```

with:

```ts
    const skills = pool
      .filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        shared: s.agentId === null,
      }));
    // The bundled operating manual has no DB row — surface it like any skill.
    if (
      OPERATING_MANUAL_NAME.includes(q) ||
      OPERATING_MANUAL_DESCRIPTION.toLowerCase().includes(q)
    ) {
      skills.unshift({
        id: OPERATING_MANUAL_NAME,
        name: OPERATING_MANUAL_NAME,
        description: OPERATING_MANUAL_DESCRIPTION,
        shared: true,
      });
    }
    return JSON.stringify({ skills });
```

- [ ] **Step 5: Add the `skill_read` fallback**

In `tools-memory.ts`, in `skillRead.run`, replace:

```ts
    const skill =
      repo.getByName(ctx.companyId, ctx.agentId, name) ?? repo.getByName(ctx.companyId, null, name);
    if (skill === null) throw new Error(`skill not found: ${name}`);
```

with:

```ts
    const skill =
      repo.getByName(ctx.companyId, ctx.agentId, name) ?? repo.getByName(ctx.companyId, null, name);
    if (skill === null) {
      // The operating manual is a bundled document, not a row — serve it here.
      if (name === OPERATING_MANUAL_NAME) {
        return JSON.stringify({ name: OPERATING_MANUAL_NAME, version: 1, body: OPERATING_MANUAL });
      }
      throw new Error(`skill not found: ${name}`);
    }
```

- [ ] **Step 6: Add the `skill_create` reserved-name guard**

In `tools-memory.ts`, in `skillCreate.run`, replace:

```ts
    const { name, description, body } = skillCreate.inputSchema.parse(input) as {
      name: string;
      description: string;
      body: string;
    };
    assertSane(body);
```

with:

```ts
    const { name, description, body } = skillCreate.inputSchema.parse(input) as {
      name: string;
      description: string;
      body: string;
    };
    if (name === OPERATING_MANUAL_NAME) {
      throw new Error(`"${OPERATING_MANUAL_NAME}" is a reserved bundled skill name`);
    }
    assertSane(body);
```

- [ ] **Step 7: Run the full file's tests to verify they pass**

Run: `pnpm --filter @prospero/main exec vitest run src/mcp/tools-memory.test.ts`
Expected: PASS — all tests, including the three new ones.

- [ ] **Step 8: Commit**

```bash
git add apps/main/src/mcp/tools-memory.ts apps/main/src/mcp/tools-memory.test.ts
git commit -m "feat(manual): serve the operating manual through the skill tools"
```

---

## Task 4: Operational-contract pointer + docs

**Files:**
- Modify: `apps/main/src/orchestrator/preamble.md`
- Modify: `docs/skills-format.md`

This task is markdown only — no automated test. Verified by Step 3 (grep) and `pnpm typecheck` in Task 5.

- [ ] **Step 1: Append the Operating Manual pointer to `preamble.md`**

In `apps/main/src/orchestrator/preamble.md`, replace the final lines:

```
If you mark an issue done without an artifact, `update_issue` returns a soft
warning — it doesn't block, but the user sees the gap.

---
```

with:

```
If you mark an issue done without an artifact, `update_issue` returns a soft
warning — it doesn't block, but the user sees the gap.

# The operating manual

A company-wide skill named `operating-manual` is always available to you — it
is the full playbook for how this company operates: the issue lifecycle, when
to record artifacts, the delegation protocol, cost discipline, and goal-plan
mechanics. Before any non-trivial task, `skill_read` it and follow it.

---
```

- [ ] **Step 2: Document the bundled manual in `docs/skills-format.md`**

In `docs/skills-format.md`, add this section immediately before the `## Body cap and sanitizer` section:

```markdown
## The bundled operating manual

One skill is not stored in the `skills` table at all: `operating-manual`. It is
a compiled-in document (`apps/main/src/orchestrator/operating-manual.ts`)
shipped with the app — the company-wide playbook for the issue lifecycle,
artifacts, delegation, cost discipline, and goal-plan mechanics.

It behaves like a company-global skill from an agent's point of view:
`buildMemoryBlock` injects its L0 entry into every agent's `## Your skills`
block, and `skill_read` serves its body on demand. It has no row, no
`body_path`, and no per-company state. The name `operating-manual` is
**reserved** — `skill_create` rejects it so a real skill cannot shadow it.

---
```

- [ ] **Step 3: Verify the edits**

Run: `grep -c "operating-manual" apps/main/src/orchestrator/preamble.md docs/skills-format.md`
Expected: each file reports at least `1`.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/orchestrator/preamble.md docs/skills-format.md
git commit -m "docs(manual): point the operational contract at the operating manual"
```

---

## Task 5: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: every package exits 0.

- [ ] **Step 2: Lint the whole workspace**

Run: `pnpm lint`
Expected: every package exits 0.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all packages green. New tests: `operating-manual.test.ts` (4) and three new `tools-memory.test.ts` tests; one `system-prompt-memory.test.ts` test rewritten (count unchanged). Expect roughly **1239 passing + 2 todo** (baseline 1232 + 7), no regressions.

- [ ] **Step 4: Manual smoke (record the result, do not skip)**

Run `pnpm dev`, hire or open an agent, and confirm via its activity/tool history:
1. The agent's system prompt contains a `## Your skills` block with the
   `operating-manual:` L0 line.
2. Ask the agent (or have it) call `skill_read` with `name: "operating-manual"`
   — it returns the full manual body.
3. `skill_search` for "delegation" or "operating" lists `operating-manual`.

Record the smoke result in the commit/PR notes. (Per project convention this is the owner's call — do not block on it.)

- [ ] **Step 5: Final commit (only if smoke surfaced fixes)**

```bash
git add -A
git commit -m "fix(manual): address smoke-test findings"
```

---

## Self-Review Notes

- **Spec coverage (M12 §13 PR-B):** "Contrato operacional core (preamble evoluído)" → Task 4 Step 1 (preamble already covers the core contract; PR-B appends the manual pointer — see the Scope note in the header). "Manual Operacional como skill bundled (sobre infra M11) + inheritance" → Tasks 1-3: the manual is delivered through the M11 skill surface (`buildMemoryBlock` L0 + `skill_read`/`skill_search`), inherited by every agent because the `memory` capability is force-added to all.
- **Design-doc deviation (§5/§16):** the manual is a compiled-in constant, not a `skills` row with `source='bundled'`. Chosen by the user at planning time — avoids a table-recreation migration, lazy per-company seeding, and file-staleness handling, for no behavioural difference. The agent-facing experience (L0 entry + `skill_read`) is identical.
- **Out of scope:** the `agent_runs`/budget/Run Policy work, the Instructions tab, and `composeSystemPrompt` reading the charter are later PRs (C and E). PR-B touches only the system-prompt skill surface.
- **Type consistency:** `OPERATING_MANUAL_NAME` / `OPERATING_MANUAL_DESCRIPTION` / `OPERATING_MANUAL` are defined once in Task 1 and imported unchanged in Tasks 2 and 3. The `skill_search` synthetic entry matches the existing result shape `{ id, name, description, shared }`.
- **No placeholder scan hits.** Every code step shows complete code.
