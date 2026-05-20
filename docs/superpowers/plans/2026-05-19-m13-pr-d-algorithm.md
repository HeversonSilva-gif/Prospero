# M13 PR-D — The Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "The Algorithm" — the 7-phase operating loop (OBSERVE→THINK→PLAN→BUILD→EXECUTE→VERIFY→LEARN) — as a bundled L0 skill every agent has, plus enrich the M11 derivation pipeline so the LEARN phase pumps richer signal (ISC outcomes + attempts) back into skill candidates, and turn `verification_failed` into a derivation trigger.

**Architecture:** The Algorithm rides on the exact mechanism the Operating Manual rides on (M12 PR-B) — a compiled markdown constant exposed as an L0 synthetic entry in `buildMemoryBlock`, with the body served on demand by `skill_read`. No DB row, no migration for the skill itself. Two things change in the data: (a) `goal_criteria` gets an `attempts` counter so "passed first try" vs "failed 3 times" is finally derivable; (b) the M11 derivation trail/prompt for `issue.done` and `goal.achieved` carries the criteria summary into the synthesis prompt, and `verification_failed` becomes a fourth derivation trigger.

**Tech Stack:** TypeScript, Electron, better-sqlite3, MCP SDK, vitest.

**Spec:** `docs/superpowers/specs/2026-05-18-m13-outcome-verification-spine-design.md` — §8 (Algorithm), §10 (system prompt slots), §11 (token efficiency), §15 row D, §16 (testing). M13 PR-A / PR-B (B1+B2) / PR-C all merged (HEAD `d4bea37`, 1485 tests).

**Locked design decisions:**
- **Algorithm = compiled constant + L0 synthetic, NOT a DB row** — copies the M12 PR-B Operating Manual pattern verbatim (`apps/main/src/orchestrator/algorithm.ts`, exposed in `buildMemoryBlock`, served by `skill_read` fallback).
- **The Algorithm is INSTRUCTION, not a state machine.** The body is markdown the agent reads; nothing in the orchestrator enforces phase transitions. VERIFY is the only "hard" phase, and even then the enforcement lives in the verification engine (PR-B1) — the Algorithm just tells the agent to call `criterion_check` before marking `done`.
- **Operating Manual pointer added (one paragraph).** That paragraph is the project's "mode classifier" — substantive work → run the Algorithm; trivial chat → don't bother. No separate classifier model, per spec §8.2.
- **LEARN enrichment = `attempts` counter + criteria summary in the trail.** The current `goal_criteria` schema records only the LAST result. To honor §8.5's "ISC failed 3× then passed" example we add ONE column (`attempts INTEGER NOT NULL DEFAULT 0`), bumped on every `applyResult`. With `attempts` + `status` we derive "first try", "after N tries", etc. — the smallest viable signal. No per-attempt history table (YAGNI).
- **`verification_failed` becomes the 4th derivation trigger.** The verification engine writes a new activity event (`verification.failed`) alongside the inbox emission; the dispatcher picks it up and routes a `verification_failed` derivation job. The synthesized skill candidate goes through the same human-review inbox as every other M11 candidate (no auto-accept).
- The Algorithm body is **English**, like the Operating Manual and the charter. Hard-to-vary heuristic embedded textually in THINK and VERIFY per §8.4 — no model, no code.
- **No new MCP tool.** The Algorithm tells the agent to use tools that already exist (`isa_read` from PR-A, `criterion_check` from PR-B2, `record_artifact` / `create_issue` / `list_issue` from earlier milestones).
- **No charter/role changes**, **no UI changes** — PR-D is invisible to the renderer. UI polish lives in PR-F.

---

## File Structure

**New files:**
- `apps/main/src/orchestrator/algorithm.ts` (+ `.test.ts`) — three exported constants `ALGORITHM_NAME` / `ALGORITHM_DESCRIPTION` / `ALGORITHM` (mirrors `operating-manual.ts`).
- `apps/main/src/db/migrations/0030_m13_criterion_attempts.sql` (+ `0030.test.ts`) — adds `goal_criteria.attempts`.
- `apps/main/src/derivation/verification-failed-trail.ts` (+ `.test.ts`) — `buildVerificationFailedTrail(db, goalId, failedCriterionIds)` → trail.

**Modified files:**
- `apps/main/src/orchestrator/operating-manual.ts` — pointer paragraph telling agents to run the Algorithm on substantive issues.
- `apps/main/src/orchestrator/system-prompt-memory.ts` — inject the Algorithm L0 line next to the Operating Manual line.
- `apps/main/src/orchestrator/system-prompt-memory.test.ts` — assert the algorithm L0 line shows up.
- `apps/main/src/mcp/tools-memory.ts` — `skill_read` fallback, `skill_search` fallback, reserved-name gate all extended for `ALGORITHM_NAME`.
- `apps/main/src/mcp/tools-memory.test.ts` (or whichever test file covers `tools-memory`) — assert the algorithm fallback paths.
- `packages/shared/src/types/criterion.ts` (or wherever `GoalCriterion` lives) — add `attempts: number`.
- `apps/main/src/goals/criteria-repository.ts` — `applyResult` bumps `attempts`; `rowToCriterion` maps `attempts`; SELECT statements include the column.
- `apps/main/src/goals/criteria-repository.test.ts` — new tests around the counter.
- `apps/main/src/derivation/trail.ts` — `IssueTrail` + `GoalTrail` gain a `criteria: TrailCriterion[]` field; `buildIssueTrail` / `buildGoalTrail` populate it.
- `apps/main/src/derivation/prompts.ts` — `buildIssuePrompt` + `buildRetrospectivePrompt` render the criteria summary; new `buildVerificationFailedPrompt`.
- `apps/main/src/derivation/prompts.test.ts` — assert the new sections appear when present and stay quiet when absent.
- `apps/main/src/verification/index.ts` — record a `verification.failed` activity event alongside the inbox emission.
- `apps/main/src/derivation/dispatcher.ts` — detect `verification.failed` activity, return a `DerivationJob { trigger: "verification_failed", goalId, failedCriterionIds }`.
- `apps/main/src/derivation/worker.ts` — `DerivationJob` union gains `"verification_failed"`; new `else if` branch builds the trail and prompt; exhaustiveness guard preserved.
- `apps/main/src/derivation/dispatcher.test.ts` and `worker.test.ts` — new cases for the trigger.

---

## Task 1: Algorithm constant + test

**Files:**
- Create: `apps/main/src/orchestrator/algorithm.ts`
- Create: `apps/main/src/orchestrator/algorithm.test.ts`

> First read `apps/main/src/orchestrator/operating-manual.ts` and `apps/main/src/orchestrator/operating-manual.test.ts` — `algorithm.ts` mirrors them exactly (three exports, same caps, same test shape).

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/orchestrator/algorithm.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ALGORITHM, ALGORITHM_DESCRIPTION, ALGORITHM_NAME } from "./algorithm.js";

describe("algorithm bundled skill", () => {
  it("ALGORITHM_NAME is the kebab-case identifier 'algorithm'", () => {
    expect(ALGORITHM_NAME).toBe("algorithm");
  });

  it("ALGORITHM_DESCRIPTION fits the L0 line (<= 200 chars)", () => {
    expect(ALGORITHM_DESCRIPTION.length).toBeGreaterThan(0);
    expect(ALGORITHM_DESCRIPTION.length).toBeLessThanOrEqual(200);
  });

  it("ALGORITHM body fits the skill_read body cap (<= 16384 chars) and is substantive", () => {
    expect(ALGORITHM.length).toBeGreaterThan(1024);
    expect(ALGORITHM.length).toBeLessThanOrEqual(16384);
  });

  it("ALGORITHM body names all 7 phases as level-2 headings, in order", () => {
    const phases = ["OBSERVE", "THINK", "PLAN", "BUILD", "EXECUTE", "VERIFY", "LEARN"];
    let cursor = 0;
    for (const p of phases) {
      const idx = ALGORITHM.indexOf(`## `, cursor);
      expect(idx, `missing or out-of-order phase ${p}`).toBeGreaterThanOrEqual(0);
      // Each phase heading should appear after the previous one and reference the phase name.
      const headingLine = ALGORITHM.slice(idx, ALGORITHM.indexOf("\n", idx));
      expect(headingLine, `phase ${p} expected near offset ${idx}`).toContain(p);
      cursor = idx + 3;
    }
  });

  it("ALGORITHM body instructs VERIFY to call criterion_check before marking done", () => {
    expect(ALGORITHM).toMatch(/criterion_check/);
    expect(ALGORITHM.toLowerCase()).toContain("verify");
  });

  it("ALGORITHM body embeds the hard-to-vary heuristic", () => {
    // §8.4: "hard to vary" is the textual quality bar in THINK and VERIFY.
    expect(ALGORITHM.toLowerCase()).toMatch(/hard to vary/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test algorithm.test`
Expected: FAIL — `Cannot find module './algorithm.js'`.

- [ ] **Step 3: Create the algorithm constant**

Create `apps/main/src/orchestrator/algorithm.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test algorithm.test`
Expected: PASS — 6 tests.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/algorithm.ts apps/main/src/orchestrator/algorithm.test.ts
git commit -m "feat(algorithm): add bundled skill constant"
```

---

## Task 2: Operating Manual pointer

**Files:**
- Modify: `apps/main/src/orchestrator/operating-manual.ts`
- Modify: `apps/main/src/orchestrator/operating-manual.test.ts`

> Read `operating-manual.ts` to find the right insertion spot — a paragraph near the section that talks about issue work / delegation. The pointer is one paragraph; do not rewrite the manual. Per spec §8.2 the pointer is the "mode classifier" — substantive issue → run the Algorithm; trivial chat turn → don't.

- [ ] **Step 1: Add a failing test asserting the pointer**

In `apps/main/src/orchestrator/operating-manual.test.ts`, add:

```typescript
  it("points agents at the algorithm skill for non-trivial issues", () => {
    expect(OPERATING_MANUAL).toMatch(/algorithm/);
    expect(OPERATING_MANUAL.toLowerCase()).toMatch(/non-trivial|substantive/);
  });
```

Run: `pnpm --filter @prospero/main test operating-manual.test`
Expected: FAIL — `algorithm` not yet referenced in `OPERATING_MANUAL`.

- [ ] **Step 2: Insert the pointer paragraph**

In `apps/main/src/orchestrator/operating-manual.ts`, add the following paragraph at the start of the section that describes how an agent picks up issues (read the file and place it where it fits — near the "issue lifecycle" / "delegation protocol" prose; if no obvious section heading exists, place it right after the introduction):

```
When you pick up a non-trivial issue — a feature, a fix, a refactor — run **The Algorithm** (skill \`algorithm\`). Its seven phases (observe, think, plan, build, execute, verify, learn) are the operating loop, and VERIFY is enforced by the verification engine. For a trivial chat turn — a question, a one-line update — reply directly; you do not need the loop.
```

(The text is inside the existing template string. Mind the backticks — escape them with a backslash since the file uses a backtick-delimited template literal.)

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test operating-manual.test`
Expected: PASS — all prior tests plus the new one.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean. The pre-existing test that checks `OPERATING_MANUAL.length` against the 1024+ minimum / 16384 maximum still passes (the addition is ~350 chars).

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/orchestrator/operating-manual.ts apps/main/src/orchestrator/operating-manual.test.ts
git commit -m "feat(algorithm): point the operating manual at the algorithm skill"
```

---

## Task 3: L0 injection in buildMemoryBlock

**Files:**
- Modify: `apps/main/src/orchestrator/system-prompt-memory.ts`
- Modify: `apps/main/src/orchestrator/system-prompt-memory.test.ts`

> Read the existing `manualLine` injection (the briefing says lines 85-94 of `system-prompt-memory.ts`). Mirror it: build an `algorithmLine`, push BOTH into the skills section. The Algorithm goes RIGHT AFTER the Operating Manual (both are bundled L0 skills that should never be crowded out by user skills).

- [ ] **Step 1: Add a failing test**

In `apps/main/src/orchestrator/system-prompt-memory.test.ts`, add (place it near the existing "always includes the operating manual" test):

```typescript
  it("always includes the algorithm L0 entry, even with no memory or skills", () => {
    const block = buildMemoryBlock(deps(s)) ?? "";
    expect(block).toContain("## Your skills");
    expect(block).toContain("algorithm");
  });

  it("lists both bundled L0 skills (operating-manual and algorithm) before any user skill", () => {
    const block = buildMemoryBlock(deps(s)) ?? "";
    const opIdx = block.indexOf("operating-manual");
    const algoIdx = block.indexOf("algorithm");
    expect(opIdx).toBeGreaterThan(-1);
    expect(algoIdx).toBeGreaterThan(opIdx); // algorithm appears after operating-manual
  });
```

Run: `pnpm --filter @prospero/main test system-prompt-memory`
Expected: FAIL — `algorithm` not in the rendered block.

- [ ] **Step 2: Inject the algorithm line**

In `apps/main/src/orchestrator/system-prompt-memory.ts`, where `manualLine` is built and pushed (around line 85-94 per the briefing), add an `algorithmLine` right after it. The replacement block — adapt to the real file:

```typescript
  import {
    OPERATING_MANUAL_NAME,
    OPERATING_MANUAL_DESCRIPTION,
  } from "./operating-manual.js";
  import { ALGORITHM_NAME, ALGORITHM_DESCRIPTION } from "./algorithm.js";

  // ...elsewhere, in the skills-section assembly:

  const manualLine = `- ${OPERATING_MANUAL_NAME}: ${OPERATING_MANUAL_DESCRIPTION}\n`;
  const algorithmLine = `- ${ALGORITHM_NAME}: ${ALGORITHM_DESCRIPTION}\n`;
  sections.push(
    `## Your skills\n\nYou have these skills (procedural know-how). Use skill_read to load one:\n\n${(
      manualLine + algorithmLine + dbSkills
    ).trimEnd()}`,
  );
```

(If `dbSkills` is computed elsewhere or the section assembly differs, keep the surrounding shape — only add the `algorithmLine` and concatenate it after `manualLine` and before `dbSkills`.)

- [ ] **Step 3: Run test + typecheck**

Run: `pnpm --filter @prospero/main test system-prompt-memory`
Expected: PASS — the new tests plus all existing ones.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/orchestrator/system-prompt-memory.ts apps/main/src/orchestrator/system-prompt-memory.test.ts
git commit -m "feat(algorithm): inject the algorithm L0 entry into the memory block"
```

---

## Task 4: skill_read / skill_search / reserved-name wiring

**Files:**
- Modify: `apps/main/src/mcp/tools-memory.ts`
- Modify: the corresponding test file (likely `apps/main/src/mcp/tools-memory.test.ts` — confirm)

> Three changes in one file (one task because they are all the same shape: "if the name matches `ALGORITHM_NAME`, do the same thing the file already does for `OPERATING_MANUAL_NAME`"). Read the file to find each occurrence of `OPERATING_MANUAL_NAME` and add a parallel branch for `ALGORITHM_NAME` next to it. There are three sites per the briefing (skill_read fallback ~line 86, skill_search ~line 58, reserved-name guard ~line 117).

- [ ] **Step 1: Add failing tests**

In `apps/main/src/mcp/tools-memory.test.ts`, add:

```typescript
  describe("algorithm bundled skill fallbacks", () => {
    it("skill_read returns the algorithm body when no DB row exists", async () => {
      const { ctx } = setup();
      const skillRead = memoryToolDefinitions.find((t) => t.name === "skill_read")!;
      const out = JSON.parse(await skillRead.run({ name: "algorithm" }, ctx)) as {
        name: string;
        version: number;
        body: string;
      };
      expect(out.name).toBe("algorithm");
      expect(out.version).toBe(1);
      expect(out.body).toMatch(/OBSERVE/);
    });

    it("skill_search surfaces the algorithm when the query matches its name", async () => {
      const { ctx } = setup();
      const skillSearch = memoryToolDefinitions.find((t) => t.name === "skill_search")!;
      const out = JSON.parse(await skillSearch.run({ query: "algo" }, ctx)) as {
        skills: { name: string }[];
      };
      expect(out.skills.some((s) => s.name === "algorithm")).toBe(true);
    });

    it("agents cannot create a skill named 'algorithm' (reserved)", async () => {
      const { ctx } = setup();
      const skillCreate = memoryToolDefinitions.find((t) => t.name === "skill_create")!;
      await expect(
        skillCreate.run({ name: "algorithm", description: "x", body: "x" }, ctx),
      ).rejects.toThrow(/reserved/);
    });
  });
```

> Match the existing test helpers — `setup()`, `memoryToolDefinitions` (or whatever the array is called in this file), the `skill_create` shape. If `skill_create` requires extra fields, copy a sibling test's call shape.

Run: `pnpm --filter @prospero/main test tools-memory`
Expected: FAIL — `skill not found: algorithm` for the first two; missing rejection for the third.

- [ ] **Step 2: Wire the three fallbacks**

In `apps/main/src/mcp/tools-memory.ts`:

1. Add the import (next to the existing `operating-manual` import):
```typescript
import { ALGORITHM, ALGORITHM_DESCRIPTION, ALGORITHM_NAME } from "../orchestrator/algorithm.js";
```

2. **`skill_read` fallback** — find the `if (name === OPERATING_MANUAL_NAME)` block (around line 86 per the briefing). Add a parallel branch next to it:
```typescript
      if (name === OPERATING_MANUAL_NAME) {
        return JSON.stringify({ name: OPERATING_MANUAL_NAME, version: 1, body: OPERATING_MANUAL });
      }
      if (name === ALGORITHM_NAME) {
        return JSON.stringify({ name: ALGORITHM_NAME, version: 1, body: ALGORITHM });
      }
      throw new Error(`skill not found: ${name}`);
```

3. **`skill_search` fallback** — find the block that unshifts the Operating Manual when its name/description matches the query (around line 58 per the briefing). Add an identical block for `ALGORITHM_NAME`:
```typescript
    if (
      ALGORITHM_NAME.includes(q) ||
      ALGORITHM_DESCRIPTION.toLowerCase().includes(q)
    ) {
      skills.unshift({
        id: ALGORITHM_NAME,
        name: ALGORITHM_NAME,
        description: ALGORITHM_DESCRIPTION,
        shared: true,
      });
    }
```
(Match the field shape the file uses — the briefing's snippet is the literal current code, but if the file has more/different fields, mirror them.)

4. **Reserved-name guard** in `skill_create` (around line 117 per the briefing):
```typescript
    if (name === OPERATING_MANUAL_NAME) {
      throw new Error(`"${OPERATING_MANUAL_NAME}" is a reserved bundled skill name`);
    }
    if (name === ALGORITHM_NAME) {
      throw new Error(`"${ALGORITHM_NAME}" is a reserved bundled skill name`);
    }
```

- [ ] **Step 3: Run test + typecheck**

Run: `pnpm --filter @prospero/main test tools-memory`
Expected: PASS — the 3 new tests plus all existing ones.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/mcp/tools-memory.ts apps/main/src/mcp/tools-memory.test.ts
git commit -m "feat(algorithm): serve the algorithm body via skill_read fallback"
```

---

## Task 5: Migration 0030 — goal_criteria.attempts

**Files:**
- Create: `apps/main/src/db/migrations/0030_m13_criterion_attempts.sql`
- Create: `apps/main/src/db/migrations/0030.test.ts`

> Read a recent `ALTER TABLE ... ADD COLUMN` migration (`0029_m13_telos.sql` from PR-C) for the convention. The PR-C lessons memory notes that the highest migration as of HEAD is `0029` — confirm by `ls apps/main/src/db/migrations/`.

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/db/migrations/0030.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

type ColumnRow = { name: string; dflt_value: string | null; notnull: number };

describe("migration 0030 — goal_criteria.attempts", () => {
  it("adds the attempts column with default 0 and NOT NULL", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(goal_criteria)").all() as ColumnRow[];
    const attempts = cols.find((c) => c.name === "attempts");
    expect(attempts).toBeDefined();
    expect(attempts!.notnull).toBe(1);
    expect(attempts!.dflt_value).toBe("0");
  });

  it("existing criteria backfill to attempts = 0 with the column default", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    // Insert a minimal company + goal + criterion to exercise the default.
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      "INSERT INTO goals (id, company_id, title, status, created_at, updated_at) VALUES ('g1','c1','t','in_progress',0,0)",
    ).run();
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, created_at, updated_at) VALUES ('cr1','g1',0,'s','deterministic','pending',0,0)",
    ).run();
    const row = db
      .prepare("SELECT attempts FROM goal_criteria WHERE id = 'cr1'")
      .get() as { attempts: number };
    expect(row.attempts).toBe(0);
  });
});
```

> If the `goals` / `companies` minimal INSERT above does not match the real column lists, copy the working INSERTs from a sibling migration test (e.g. `0029.test.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test 0030`
Expected: FAIL — `no such column: attempts`.

- [ ] **Step 3: Write the migration**

Create `apps/main/src/db/migrations/0030_m13_criterion_attempts.sql`:

```sql
-- M13 PR-D: goal_criteria.attempts — counts how many times a criterion has
-- been checked (via applyResult). With attempts + status we can derive
-- "passed first try" (attempts=1, status=passed) vs "failed N times then
-- passed" (attempts>1, status=passed) vs "still failing" (attempts>0,
-- status=failed). This is the smallest signal the LEARN phase of the
-- Algorithm needs to enrich the M11 derivation pipeline per spec §8.5.
-- Existing rows backfill to 0 via the column default.

ALTER TABLE goal_criteria ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test 0030`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/db/migrations/0030_m13_criterion_attempts.sql apps/main/src/db/migrations/0030.test.ts
git commit -m "feat(criterion): add attempts counter column"
```

---

## Task 6: applyResult bumps attempts + repo wiring

**Files:**
- Modify: `packages/shared/src/types/criterion.ts` (or wherever `GoalCriterion` is defined — read the existing import in `criteria-repository.ts` to find it)
- Modify: `apps/main/src/goals/criteria-repository.ts`
- Modify: `apps/main/src/goals/criteria-repository.test.ts`

> The PR-C lessons memory and PR-A lessons memory both flag: changing a `@prospero/shared` type breaks every literal fixture across BOTH `apps/main` and `apps/renderer`. Run typecheck on both at the end of this task and fix every literal the typecheck flags.

- [ ] **Step 1: Add `attempts` to the shared `GoalCriterion` type**

In `packages/shared/src/types/criterion.ts` (or the file that defines `GoalCriterion`), add the field:

```typescript
export type GoalCriterion = {
  // ...existing fields...
  attempts: number; // M13 PR-D: how many times applyResult has run on this row.
};
```

- [ ] **Step 2: Write the failing test**

In `apps/main/src/goals/criteria-repository.test.ts`, add (adapt to the file's existing `describe`/`db` setup):

```typescript
  it("listByGoal returns attempts (0 by default for a fresh criterion)", () => {
    const repo = createGoalCriteriaRepository(db);
    // Seed a goal + criterion using the file's existing helpers. If there's a
    // `seedCriterion()` helper, use it; otherwise raw-insert as the other tests do.
    repo.insert({
      goalId: SEED_GOAL_ID, // use whatever the test file's seed goal id is
      sortOrder: 0,
      statement: "s",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { command: "echo ok", expectedExitCode: 0, timeoutMs: 1000 },
    });
    const list = repo.listByGoal(SEED_GOAL_ID);
    expect(list[0]!.attempts).toBe(0);
  });

  it("applyResult bumps attempts by 1 per call", () => {
    const repo = createGoalCriteriaRepository(db);
    const id = repo.insert({
      goalId: SEED_GOAL_ID,
      sortOrder: 0,
      statement: "s",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { command: "echo ok", expectedExitCode: 0, timeoutMs: 1000 },
    });
    repo.applyResult({ criterionId: id, status: "failed", detail: "x", resultJson: {} });
    repo.applyResult({ criterionId: id, status: "failed", detail: "x", resultJson: {} });
    repo.applyResult({ criterionId: id, status: "passed", detail: "x", resultJson: {} });
    expect(repo.getById(id)!.attempts).toBe(3);
  });
```

> Adapt the test to match the existing file's seed pattern, the `insert(...)` shape, and the `applyResult` argument shape. The point is: the counter starts at 0 and increments on every `applyResult`.

Run: `pnpm --filter @prospero/main test criteria-repository`
Expected: FAIL — `attempts` is `undefined` (not mapped) and the counter doesn't bump.

- [ ] **Step 3: Map and bump `attempts` in the repo**

In `apps/main/src/goals/criteria-repository.ts`:

1. **Map the column** — find every SELECT statement against `goal_criteria` (`listByGoal`, `getById`, anywhere else) and add `attempts` to the column list. Update `rowToCriterion` (and its row type) to read `attempts: row.attempts`.

```typescript
const rowToCriterion = (row: {
  // ...existing fields...
  attempts: number;
}): GoalCriterion => ({
  // ...existing mappings...
  attempts: row.attempts,
});
```

2. **Bump in `applyResult`** — find the `applyResultStmt` (the briefing showed it around lines 143-151). Change its UPDATE to also increment `attempts`:

```typescript
  const applyResultStmt = db.prepare(
    "UPDATE goal_criteria SET status = @status, last_checked_at = @checkedAt, last_result_json = @resultJson, updated_at = @updatedAt, attempts = attempts + 1 WHERE id = @id",
  );
```

(Match the actual parameter names / `@param` style of the existing prepared statement. If it uses positional `?`, switch to that.)

- [ ] **Step 4: Run test + typecheck (both packages)**

Run: `pnpm --filter @prospero/main test criteria-repository`
Expected: PASS.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean. If any literal `GoalCriterion` fixture in `apps/main/tests/` or elsewhere fails because it lacks `attempts`, add `attempts: 0` to it.
Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean. If any renderer fixture builds a `GoalCriterion` literal, add `attempts: 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/criterion.ts apps/main/src/goals/criteria-repository.ts apps/main/src/goals/criteria-repository.test.ts apps/renderer/src
git commit -m "feat(criterion): bump attempts on every applyResult"
```

(Adjust `git add` to the actual files touched, including any fixture fixes from Step 4.)

---

## Task 7: IssueTrail enrichment with criteria

**Files:**
- Modify: `apps/main/src/derivation/trail.ts`
- Modify: `apps/main/src/derivation/trail.test.ts`

> Read `trail.ts` for the existing `IssueTrail` type + `buildIssueTrail(db, issueId)` function. The new field surfaces the ISCs an issue advances (via the `issue_criteria` join from PR-B1) plus their current status + attempts. The PR-B1 lessons memory notes that `Issue` does not expose `goalId` directly — use `IssuesRepository.getGoalId(issueId)` if you need the goal id.

- [ ] **Step 1: Add a failing test**

In `apps/main/src/derivation/trail.test.ts`, add (match the file's existing test setup helpers):

```typescript
  it("buildIssueTrail includes the criteria this issue advances, with status and attempts", () => {
    // Seed: a company, a goal with 2 criteria, an issue advancing both, and
    // 2 prior applyResult calls on criterion 1 so its attempts = 2.
    const ctx = seed(); // existing helper or inline raw inserts
    const trail = buildIssueTrail(ctx.db, ctx.issueId);
    expect(trail).not.toBeNull();
    expect(trail!.criteria).toBeDefined();
    expect(trail!.criteria!.length).toBe(2);
    const cr1 = trail!.criteria!.find((c) => c.statement === "build passes");
    expect(cr1).toBeDefined();
    expect(cr1!.status).toBe("passed");
    expect(cr1!.attempts).toBe(2);
  });

  it("buildIssueTrail returns an empty criteria array for an issue with no goal link", () => {
    const ctx = seedStandaloneIssue(); // an issue not tied to a goal
    const trail = buildIssueTrail(ctx.db, ctx.issueId);
    expect(trail).not.toBeNull();
    expect(trail!.criteria).toEqual([]);
  });
```

> If `trail.test.ts` does not yet exist, create it; mirror the test style of `worker.test.ts` for the seeding pattern (raw INSERTs into companies/goals/issues/goal_criteria/issue_criteria are fine).

Run: `pnpm --filter @prospero/main test derivation/trail`
Expected: FAIL — `criteria` is not a property of `IssueTrail`.

- [ ] **Step 2: Extend the type + builder**

In `apps/main/src/derivation/trail.ts`:

1. Add the shared shape:
```typescript
export type TrailCriterion = {
  statement: string;
  kind: "deterministic" | "judgment";
  status: "pending" | "passed" | "failed" | "waived";
  attempts: number;
};
```
2. Extend `IssueTrail`:
```typescript
export type IssueTrail = {
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  comments: TrailEntry[];
  criteria: TrailCriterion[]; // empty when the issue is not tied to a goal
};
```
3. In `buildIssueTrail(db, issueId)`, after the existing reads (comments etc.), resolve the goal id and query the criteria the issue advances:

```typescript
import { createIssuesRepository } from "../issues/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";

// ...inside buildIssueTrail, before returning the trail:

const goalId = createIssuesRepository(db).getGoalId(issueId);
let criteria: TrailCriterion[] = [];
if (goalId !== null) {
  const rows = db
    .prepare(
      `SELECT gc.statement, gc.kind, gc.status, gc.attempts
       FROM goal_criteria gc
       JOIN issue_criteria ic ON ic.criterion_id = gc.id
       WHERE ic.issue_id = ?
       ORDER BY gc.sort_order`,
    )
    .all(issueId) as Array<{
    statement: string;
    kind: "deterministic" | "judgment";
    status: "pending" | "passed" | "failed" | "waived";
    attempts: number;
  }>;
  criteria = rows;
}

return {
  issueId,
  identifier: /* existing */,
  title: /* existing */,
  description: /* existing */,
  comments: /* existing */,
  criteria,
};
```

(If the existing file uses `createGoalCriteriaRepository(db).listByGoal(goalId)` + an in-memory filter against the `issue_criteria` rows would be cleaner, do that. The point is: only the criteria THIS issue advances, in `sort_order`, with statement/kind/status/attempts.)

- [ ] **Step 3: Run test + typecheck**

Run: `pnpm --filter @prospero/main test derivation/trail`
Expected: PASS — the 2 new tests plus existing ones.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/derivation/trail.ts apps/main/src/derivation/trail.test.ts
git commit -m "feat(derivation): include criteria summary in the issue trail"
```

---

## Task 8: GoalTrail enrichment with criteria

**Files:**
- Modify: `apps/main/src/derivation/trail.ts`
- Modify: `apps/main/src/derivation/trail.test.ts`

> Same shape as Task 7, but for the `goal_achieved` trigger — the retrospective gets the criteria summary for ALL criteria of the goal (not filtered by issue).

- [ ] **Step 1: Add a failing test**

In `apps/main/src/derivation/trail.test.ts`, add:

```typescript
  it("buildGoalTrail includes all criteria of the goal, with status and attempts", () => {
    const ctx = seedGoalWithCriteria(); // 2 criteria, criterion 1 passed first try, criterion 2 passed after 3 attempts
    const trail = buildGoalTrail(ctx.db, ctx.goalId);
    expect(trail).not.toBeNull();
    expect(trail!.criteria).toBeDefined();
    expect(trail!.criteria.length).toBe(2);
    const passedFirstTry = trail!.criteria.find((c) => c.attempts === 1);
    const passedAfterRetries = trail!.criteria.find((c) => c.attempts === 3);
    expect(passedFirstTry).toBeDefined();
    expect(passedFirstTry!.status).toBe("passed");
    expect(passedAfterRetries).toBeDefined();
    expect(passedAfterRetries!.status).toBe("passed");
  });
```

Run: `pnpm --filter @prospero/main test derivation/trail`
Expected: FAIL — `criteria` is not a property of `GoalTrail`.

- [ ] **Step 2: Extend the type + builder**

In `apps/main/src/derivation/trail.ts`:

1. Extend `GoalTrail`:
```typescript
export type GoalTrail = {
  title: string;
  description: string;
  successCriteria: string;
  issues: Array<{ title: string; status: string }>;
  criteria: TrailCriterion[]; // empty when the goal has no ISCs (legacy goal)
};
```
2. In `buildGoalTrail(db, goalId)`, before returning, query the criteria:

```typescript
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";

// ...inside buildGoalTrail:
const allCriteria = createGoalCriteriaRepository(db).listByGoal(goalId);
const criteria: TrailCriterion[] = allCriteria.map((c) => ({
  statement: c.statement,
  kind: c.kind,
  status: c.status,
  attempts: c.attempts,
}));

return {
  title: /* existing */,
  description: /* existing */,
  successCriteria: /* existing */,
  issues: /* existing */,
  criteria,
};
```

- [ ] **Step 3: Run test + typecheck**

Run: `pnpm --filter @prospero/main test derivation/trail`
Expected: PASS.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/derivation/trail.ts apps/main/src/derivation/trail.test.ts
git commit -m "feat(derivation): include criteria summary in the goal trail"
```

---

## Task 9: Prompt enrichment — render criteria signal

**Files:**
- Modify: `apps/main/src/derivation/prompts.ts`
- Modify: `apps/main/src/derivation/prompts.test.ts`

> Read `prompts.ts` for the existing `buildIssuePrompt(trail)` / `buildRetrospectivePrompt(trail)` shape. Add a `renderCriteria(criteria)` helper and splice it into both prompts when `criteria.length > 0`. When the array is empty, the criteria section is omitted (back-compat for legacy goals/issues without ISCs).

- [ ] **Step 1: Add failing tests**

In `apps/main/src/derivation/prompts.test.ts`, add:

```typescript
import type { IssueTrail, GoalTrail } from "./trail.js";

const trailWithCriteria = (): IssueTrail => ({
  issueId: "i1",
  identifier: "X-1",
  title: "Add the search bar",
  description: "Add a debounced search input above the list.",
  comments: [],
  criteria: [
    { statement: "build passes", kind: "deterministic", status: "passed", attempts: 3 },
    { statement: "design review approves", kind: "judgment", status: "passed", attempts: 1 },
  ],
});

const trailWithoutCriteria = (): IssueTrail => ({
  issueId: "i1",
  identifier: "X-1",
  title: "Add the search bar",
  description: "Add a debounced search input above the list.",
  comments: [],
  criteria: [],
});

describe("buildIssuePrompt with criteria", () => {
  it("renders a criteria section that names attempts and status when present", () => {
    const prompt = buildIssuePrompt(trailWithCriteria());
    expect(prompt).toMatch(/build passes/);
    expect(prompt).toMatch(/3 attempts|after 3|3×|attempts: 3/);
  });

  it("omits the criteria section entirely when the issue has no ISCs", () => {
    const prompt = buildIssuePrompt(trailWithoutCriteria());
    expect(prompt).not.toMatch(/criteria/i);
  });
});

describe("buildRetrospectivePrompt with criteria", () => {
  it("renders the criteria summary in the retrospective", () => {
    const trail: GoalTrail = {
      title: "Ship the search feature",
      description: "Users can search the list.",
      successCriteria: "x",
      issues: [{ title: "Add the search bar", status: "done" }],
      criteria: [
        { statement: "build passes", kind: "deterministic", status: "passed", attempts: 3 },
      ],
    };
    const prompt = buildRetrospectivePrompt(trail);
    expect(prompt).toMatch(/build passes/);
    expect(prompt).toMatch(/3/);
  });
});
```

Run: `pnpm --filter @prospero/main test derivation/prompts`
Expected: FAIL — `criteria` is not rendered.

- [ ] **Step 2: Write the renderer + splice**

In `apps/main/src/derivation/prompts.ts`:

1. Add the helper:
```typescript
import type { TrailCriterion } from "./trail.js";

const renderCriterionLine = (c: TrailCriterion): string => {
  const verdict =
    c.status === "passed" && c.attempts === 1 ? "passed first try"
    : c.status === "passed" && c.attempts > 1 ? `passed after ${c.attempts} attempts`
    : c.status === "failed" && c.attempts > 1 ? `still failing after ${c.attempts} attempts`
    : c.status === "failed" ? "failed"
    : c.status === "waived" ? "waived"
    : "not yet checked";
  return `- [${c.kind}] ${c.statement} — ${verdict}`;
};

const renderCriteriaSection = (criteria: TrailCriterion[]): string => {
  if (criteria.length === 0) return "";
  return `\n\n## Criteria status\n\n${criteria.map(renderCriterionLine).join("\n")}`;
};
```

2. Extend `buildIssuePrompt` to splice the section in BEFORE the `OUTPUT_CONTRACT` block:
```typescript
export const buildIssuePrompt = (trail: IssueTrail): string =>
  `You are reviewing a software task that was just completed, to extract a reusable skill.

## Issue ${trail.identifier}: ${trail.title}

${trail.description}

## Work log (comments, oldest first)

${renderEntries(trail.comments)}${renderCriteriaSection(trail.criteria)}
${OUTPUT_CONTRACT}`;
```

3. Extend `buildRetrospectivePrompt` similarly:
```typescript
export const buildRetrospectivePrompt = (trail: GoalTrail): string =>
  `A company just achieved a goal. Write a brief retrospective — the one durable
lesson worth remembering company-wide for next time.

## Goal: ${trail.title}

${trail.description}

Success criteria: ${trail.successCriteria}

## Issues done for this goal

${trail.issues.length === 0 ? "(none)" : trail.issues.map((i) => `- [${i.status}] ${i.title}`).join("\n")}${renderCriteriaSection(trail.criteria)}
${MEMORY_OUTPUT_CONTRACT}`;
```

(Match the file's exact template-string layout. The point is: no criteria → no section; criteria present → labelled section before the output contract.)

- [ ] **Step 3: Run test + typecheck**

Run: `pnpm --filter @prospero/main test derivation/prompts`
Expected: PASS — the 3 new tests plus existing ones.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/derivation/prompts.ts apps/main/src/derivation/prompts.test.ts
git commit -m "feat(derivation): render criteria status in issue and goal prompts"
```

---

## Task 10: Verification engine writes activity event

**Files:**
- Modify: `apps/main/src/verification/index.ts`
- Modify: `apps/main/src/verification/index.test.ts` (or the existing verification test file)

> Read `verification/index.ts` lines 43-56 (the `verification_failed` inbox emission per the briefing). Record a `verification.failed` activity event on the same code path so the M11 dispatcher can pick it up. The dispatcher reads `row.action` and `row.entityId` — make `entityId = goal.id`. Confirm `activity_events.action` has no CHECK constraint (it is a free string per the M11 design — but if a CHECK exists, the migration needs extending; verify by `grep -n "CREATE TABLE activity_events" apps/main/src/db/migrations/`).

- [ ] **Step 1: Add a failing test**

In the verification test file (likely `apps/main/src/verification/index.test.ts` — confirm), add a case that asserts a `verification.failed` activity event is recorded when verification fails:

```typescript
  it("records a verification.failed activity event when a criterion fails", async () => {
    const ctx = seedVerifyingGoalWithFailingCriterion(); // existing helper or new one
    await runVerification(ctx.db, ctx.goalId);
    const rows = ctx.db
      .prepare(
        "SELECT action, entity_id, company_id FROM activity_events WHERE action = 'verification.failed'",
      )
      .all() as Array<{ action: string; entity_id: string; company_id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.entity_id).toBe(ctx.goalId);
    expect(rows[0]!.company_id).toBe(ctx.companyId);
  });
```

> Match the verification test file's existing seeding helpers. If it does not yet test activity events, mirror the pattern from a sibling file that does (search for `activity_events` in any `*.test.ts` under `apps/main/`).

Run: `pnpm --filter @prospero/main test verification`
Expected: FAIL — no `verification.failed` row exists.

- [ ] **Step 2: Record the activity event**

In `apps/main/src/verification/index.ts`, find the `failed.length > 0` branch (around line 43 per the briefing). Right next to (or just before) the existing inbox `create` call, record an activity event. Use the project's existing activity recorder — locate it by `grep -n "recordActivity\|createActivityRepository\|activity_events.*INSERT" apps/main/src/` and use the same idiom sibling code uses:

```typescript
// Pseudocode — adapt to the real recorder API in this codebase:
recordActivity(db, {
  companyId: goal.companyId,
  action: "verification.failed",
  entityId: goal.id,
  agentId: null,
  payload: { goalId: goal.id, failedCriteria: failed.map((f) => f.criterionId) },
});
```

If the recorder is fully synchronous and takes raw arguments differently, mirror the closest existing call (the M11 derivation lessons mention `recorder.recordActivity(...)` — start there).

- [ ] **Step 3: Run test + typecheck**

Run: `pnpm --filter @prospero/main test verification`
Expected: PASS.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/verification/index.ts apps/main/src/verification/index.test.ts
git commit -m "feat(verification): record a verification.failed activity event"
```

---

## Task 11: Dispatcher case + DerivationJob union

**Files:**
- Modify: `apps/main/src/derivation/dispatcher.ts`
- Modify: `apps/main/src/derivation/dispatcher.test.ts`
- Modify: `apps/main/src/derivation/worker.ts` (the `DerivationJob` type lives here per the briefing)

> Read `dispatcher.ts` (the existing 4-case `jobForActivity`) and `worker.ts` (the `DerivationJob` discriminated union). Add a fifth case mirroring the existing 4: detect `row.action === "verification.failed"`, extract the `goalId` from `row.entityId`, and pull `failedCriterionIds` from `row.payload`.

- [ ] **Step 1: Add a failing test**

In `apps/main/src/derivation/dispatcher.test.ts`, add:

```typescript
  it("routes a verification.failed activity event into a verification_failed derivation job", () => {
    const row: ActivityEventRow = {
      id: "evt-1",
      companyId: "c1",
      agentId: "a1",
      action: "verification.failed",
      entityId: "g1",
      payload: { goalId: "g1", failedCriteria: ["cr1", "cr2"] },
      // ...any other required fields the type carries — copy a sibling test row
    };
    const job = jobForActivity(row);
    expect(job).not.toBeNull();
    expect(job!.trigger).toBe("verification_failed");
    expect(job!.companyId).toBe("c1");
    expect(job!.agentId).toBe("a1");
    expect(job!.sourceEventId).toBe("evt-1");
    expect((job as { goalId: string }).goalId).toBe("g1");
    expect((job as { failedCriterionIds: string[] }).failedCriterionIds).toEqual(["cr1", "cr2"]);
  });
```

> Match the existing dispatcher tests' row-construction style (the `ActivityEventRow` type's required fields). If the existing tests use a `makeRow(...)` helper, use it.

Run: `pnpm --filter @prospero/main test dispatcher`
Expected: FAIL — the trigger does not exist on the union / the case is missing.

- [ ] **Step 2: Extend the `DerivationJob` union (worker.ts)**

In `apps/main/src/derivation/worker.ts`, find the `DerivationJob` type (around line 33 per the briefing) and add the `"verification_failed"` variant:

```typescript
export type DerivationJob =
  | { trigger: "issue_done"; companyId: string; agentId: string; sourceEventId: string; issueId: string }
  | { trigger: "recovery"; companyId: string; agentId: string; sourceEventId: string }
  | { trigger: "goal_achieved"; companyId: string; agentId: string; sourceEventId: string; goalId: string }
  | { trigger: "approval_rejected"; companyId: string; agentId: string; sourceEventId: string; approvalId: string }
  | { trigger: "verification_failed"; companyId: string; agentId: string; sourceEventId: string; goalId: string; failedCriterionIds: string[] };
```

(Adapt to the real union shape — the briefing's snippet is illustrative; match the file's actual member shapes.)

- [ ] **Step 3: Add the dispatcher case**

In `apps/main/src/derivation/dispatcher.ts`, add the new `else if` (right after the existing 4 cases, before the trailing `return null`):

```typescript
  if (row.action === "verification.failed") {
    const failedRaw = (row.payload["failedCriteria"] as unknown) ?? [];
    const failedCriterionIds = Array.isArray(failedRaw)
      ? failedRaw.filter((x): x is string => typeof x === "string")
      : [];
    return {
      trigger: "verification_failed",
      companyId: row.companyId,
      agentId: row.agentId,
      sourceEventId: row.id,
      goalId: row.entityId,
      failedCriterionIds,
    };
  }
```

(Match the file's existing payload-extraction idiom. The defensive Array.isArray guard handles a malformed payload by routing an empty list rather than throwing — keep the trigger flowing.)

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @prospero/main test dispatcher`
Expected: PASS — the new test plus existing ones.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean. The worker's exhaustiveness `never` guard will now require Task 13 (the new branch) — that is expected; finish that task before declaring this complete. If the typecheck fails here on the worker's exhaustiveness guard, that is the signal — keep moving and Task 13 will close it.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/derivation/dispatcher.ts apps/main/src/derivation/dispatcher.test.ts apps/main/src/derivation/worker.ts
git commit -m "feat(derivation): dispatch verification.failed into a derivation job"
```

(The worker file is committed here because the type union change is what makes the dispatcher typecheck; the worker's handler branch is added in Task 13.)

---

## Task 12: verification_failed trail + prompt

**Files:**
- Create: `apps/main/src/derivation/verification-failed-trail.ts`
- Create: `apps/main/src/derivation/verification-failed-trail.test.ts`
- Modify: `apps/main/src/derivation/prompts.ts`
- Modify: `apps/main/src/derivation/prompts.test.ts`

> The `verification_failed` derivation asks: what skill would prevent this kind of failure from happening again? The trail surfaces the goal context plus the specific criteria that failed (statement + last result detail).

- [ ] **Step 1: Add a failing test for the trail**

Create `apps/main/src/derivation/verification-failed-trail.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { buildVerificationFailedTrail } from "./verification-failed-trail.js";

const seed = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    "INSERT INTO goals (id, company_id, title, description, status, created_at, updated_at) VALUES ('g1','c1','Ship X','users can do Y','verifying',0,0)",
  ).run();
  db.prepare(
    "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, last_result_json, created_at, updated_at) VALUES ('cr1','g1',0,'build passes','deterministic','failed',3,'{\"detail\":\"exit 1: tsc found 2 errors\"}',0,0)",
  ).run();
  db.prepare(
    "INSERT INTO goal_criteria (id, goal_id, sort_order, statement, kind, status, attempts, last_result_json, created_at, updated_at) VALUES ('cr2','g1',1,'tests pass','deterministic','passed',1,'{}',0,0)",
  ).run();
  return { db };
};

describe("buildVerificationFailedTrail", () => {
  it("returns null when the goal is missing", () => {
    const { db } = seed();
    expect(buildVerificationFailedTrail(db, "nope", ["cr1"])).toBeNull();
  });

  it("returns the goal + only the failed criteria the dispatcher named", () => {
    const { db } = seed();
    const trail = buildVerificationFailedTrail(db, "g1", ["cr1"]);
    expect(trail).not.toBeNull();
    expect(trail!.goalTitle).toBe("Ship X");
    expect(trail!.failed.length).toBe(1);
    expect(trail!.failed[0]!.statement).toBe("build passes");
    expect(trail!.failed[0]!.attempts).toBe(3);
    expect(trail!.failed[0]!.lastDetail).toContain("tsc found 2 errors");
  });

  it("ignores ids in the payload that no longer exist", () => {
    const { db } = seed();
    const trail = buildVerificationFailedTrail(db, "g1", ["cr1", "ghost"]);
    expect(trail!.failed.length).toBe(1);
  });
});
```

Run: `pnpm --filter @prospero/main test verification-failed-trail`
Expected: FAIL — `Cannot find module './verification-failed-trail.js'`.

- [ ] **Step 2: Write the trail builder**

Create `apps/main/src/derivation/verification-failed-trail.ts`:

```typescript
import type Database from "better-sqlite3";

// The trail handed to the LEARN prompt when a goal's verification fails. We
// surface the goal context and the specific criteria the dispatcher told us
// failed, including each criterion's attempts count and the last result detail
// (truncated, so a prompt-injection attempt in stdout can't blow up the prompt).

export type VerificationFailedTrail = {
  goalId: string;
  goalTitle: string;
  goalDescription: string;
  failed: Array<{
    statement: string;
    kind: "deterministic" | "judgment";
    attempts: number;
    lastDetail: string;
  }>;
};

const MAX_DETAIL_CHARS = 1000;

const extractDetail = (resultJson: string | null): string => {
  if (resultJson === null) return "";
  try {
    const parsed = JSON.parse(resultJson) as { detail?: unknown };
    const d = typeof parsed.detail === "string" ? parsed.detail : "";
    return d.slice(0, MAX_DETAIL_CHARS);
  } catch {
    return "";
  }
};

export const buildVerificationFailedTrail = (
  db: Database.Database,
  goalId: string,
  failedCriterionIds: string[],
): VerificationFailedTrail | null => {
  const goal = db
    .prepare("SELECT id, title, description FROM goals WHERE id = ?")
    .get(goalId) as { id: string; title: string; description: string | null } | undefined;
  if (goal === undefined) return null;

  if (failedCriterionIds.length === 0) {
    return {
      goalId: goal.id,
      goalTitle: goal.title,
      goalDescription: goal.description ?? "",
      failed: [],
    };
  }

  const placeholders = failedCriterionIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT statement, kind, attempts, last_result_json
       FROM goal_criteria
       WHERE goal_id = ? AND id IN (${placeholders})
       ORDER BY sort_order`,
    )
    .all(goalId, ...failedCriterionIds) as Array<{
    statement: string;
    kind: "deterministic" | "judgment";
    attempts: number;
    last_result_json: string | null;
  }>;

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    goalDescription: goal.description ?? "",
    failed: rows.map((r) => ({
      statement: r.statement,
      kind: r.kind,
      attempts: r.attempts,
      lastDetail: extractDetail(r.last_result_json),
    })),
  };
};
```

- [ ] **Step 3: Run trail test**

Run: `pnpm --filter @prospero/main test verification-failed-trail`
Expected: PASS — 3 tests.

- [ ] **Step 4: Add a failing prompt test**

In `apps/main/src/derivation/prompts.test.ts`, add:

```typescript
describe("buildVerificationFailedPrompt", () => {
  it("names the goal and each failed criterion with attempts and last detail", () => {
    const prompt = buildVerificationFailedPrompt({
      goalId: "g1",
      goalTitle: "Ship X",
      goalDescription: "users can do Y",
      failed: [
        {
          statement: "build passes",
          kind: "deterministic",
          attempts: 3,
          lastDetail: "exit 1: tsc found 2 errors",
        },
      ],
    });
    expect(prompt).toMatch(/Ship X/);
    expect(prompt).toMatch(/build passes/);
    expect(prompt).toMatch(/3/);
    expect(prompt).toMatch(/tsc found 2 errors/);
  });
});
```

Run: `pnpm --filter @prospero/main test prompts`
Expected: FAIL — `buildVerificationFailedPrompt` not exported.

- [ ] **Step 5: Implement the prompt**

In `apps/main/src/derivation/prompts.ts`, add (next to `buildIssuePrompt` / `buildRetrospectivePrompt`):

```typescript
import type { VerificationFailedTrail } from "./verification-failed-trail.js";

export const buildVerificationFailedPrompt = (trail: VerificationFailedTrail): string => {
  const failedLines = trail.failed
    .map(
      (f) =>
        `- [${f.kind}] ${f.statement} — still failing after ${f.attempts} attempts\n  Last detail: ${f.lastDetail || "(no detail captured)"}`,
    )
    .join("\n");
  return `A goal's verification failed. Extract one durable skill — what should a future agent know to avoid this kind of failure next time? Focus on the pattern, not the one-off cause.

## Goal: ${trail.goalTitle}

${trail.goalDescription}

## Failed criteria

${failedLines === "" ? "(none)" : failedLines}
${MEMORY_OUTPUT_CONTRACT}`;
};
```

(Reuse the file's `MEMORY_OUTPUT_CONTRACT` — it is the same output contract `buildRetrospectivePrompt` already uses. If the file's existing prompts use a different output contract for issue-level vs goal-level skills, prefer `MEMORY_OUTPUT_CONTRACT` here because the failure is goal-scoped.)

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --filter @prospero/main test prompts`
Expected: PASS.
Run: `pnpm --filter @prospero/main test verification-failed-trail`
Expected: PASS.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/derivation/verification-failed-trail.ts apps/main/src/derivation/verification-failed-trail.test.ts apps/main/src/derivation/prompts.ts apps/main/src/derivation/prompts.test.ts
git commit -m "feat(derivation): add verification_failed trail and prompt"
```

---

## Task 13: Worker handler for verification_failed

**Files:**
- Modify: `apps/main/src/derivation/worker.ts`
- Modify: `apps/main/src/derivation/worker.test.ts`

> Read the existing worker's switch on `job.trigger` (around lines 78-135 per the briefing). Add the fifth `else if` branch that builds the trail, builds the prompt, and lets the rest of the worker flow handle it (runner, parse, persist) exactly as the other triggers do.

- [ ] **Step 1: Add a failing worker test**

In `apps/main/src/derivation/worker.test.ts`, add (mirror the structure of the existing `issue_done` / `goal_achieved` worker tests):

```typescript
  it("verification_failed: builds the prompt from the trail and runs derivation", async () => {
    const ctx = seedVerificationFailedScenario(); // existing helper or new one — see below
    const captured: string[] = [];
    const fakeRunner = (input: { prompt: string }) => {
      captured.push(input.prompt);
      return Promise.resolve({
        text: '{"action":"discard","reason":"nothing reusable"}',
        usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      });
    };
    await processJob(
      { db: ctx.db, runDerivation: fakeRunner, /* whatever other deps the worker accepts */ },
      {
        trigger: "verification_failed",
        companyId: "c1",
        agentId: "a1",
        sourceEventId: "evt-1",
        goalId: "g1",
        failedCriterionIds: ["cr1"],
      },
    );
    expect(captured.length).toBe(1);
    expect(captured[0]).toMatch(/Goal:/);
    expect(captured[0]).toMatch(/build passes/);
  });
```

> Adapt the test to the worker's real `processJob` (or whatever the exported function is) signature and dep shape. Reuse an existing worker test as the template for the seed helper.

Run: `pnpm --filter @prospero/main test derivation/worker`
Expected: FAIL — unhandled trigger (the exhaustiveness `never` guard fires, or the test asserts the prompt is never built).

- [ ] **Step 2: Add the handler branch**

In `apps/main/src/derivation/worker.ts`, in the same switch that handles `issue_done` / `goal_achieved` / etc. (around lines 78-135 per the briefing), add:

```typescript
import { buildVerificationFailedTrail } from "./verification-failed-trail.js";
import { buildVerificationFailedPrompt } from "./prompts.js";

// ...inside the switch:

      } else if (job.trigger === "verification_failed") {
        const trail = buildVerificationFailedTrail(db, job.goalId, job.failedCriterionIds);
        if (trail === null) {
          log(`verification_failed: goal ${job.goalId} not found — skipping`);
          return;
        }
        prompt = buildVerificationFailedPrompt(trail);
      } else {
        const _: never = job;
        // unreachable; exhaustiveness check
        void _;
      }
```

(Match the file's existing branch shape — the `prompt = ...` assignment, the `log(...)` call, the `return` on skip. The exhaustiveness `never` guard at the end is already there in the file; just make sure the new branch is included before it.)

- [ ] **Step 3: Run test + full derivation suite**

Run: `pnpm --filter @prospero/main test derivation/worker`
Expected: PASS — the new test plus existing ones.
Run: `pnpm --filter @prospero/main test derivation`
Expected: every derivation suite passes (dispatcher, worker, trail, prompts, runner, parse-output, index).
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean — the worker's exhaustiveness `never` guard is now satisfied.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/derivation/worker.ts apps/main/src/derivation/worker.test.ts
git commit -m "feat(derivation): handle verification_failed jobs in the worker"
```

---

## Task 14: Full verification + non-regression

**Files:** none (verification only).

- [ ] **Step 1: Update any tool/channel/migration count assertion**

M13 PR-D adds 0 MCP tools (Algorithm rides on existing `skill_read` / `skill_search`), 0 IPC channels, and 1 migration (`0030`). Search the test suites for a test asserting an exact count of migrations or MCP tools — if one exists and now fails, bump it. (PR-C task 18 noted no channel-count test exists; confirm again that no count assertion was added since.) Skip this step if nothing fails.

- [ ] **Step 2: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: clean across `@prospero/shared`, `@prospero/main`, `@prospero/renderer`, `@prospero/agent-runner`.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: every package green (the 2 pre-existing `todo` tests in `apps/main` are fine). Confirm the new PR-D suites pass: `algorithm.test`, `operating-manual.test` (updated), `system-prompt-memory.test` (updated), `tools-memory.test` (updated), `0030`, `criteria-repository.test` (updated), `derivation/trail.test` (updated), `derivation/prompts.test` (updated), `verification-failed-trail.test`, `verification/index.test` (updated), `derivation/dispatcher.test` (updated), `derivation/worker.test` (updated).

- [ ] **Step 5: Token efficiency — sanity check (the §11 promise)**

The PR-D additions to the agent system prompt are: one extra L0 line (~100 chars for `algorithm: ...`). The Algorithm body itself only enters the prompt if the agent calls `skill_read("algorithm")`. Confirm this by inspecting `system-prompt-memory.ts` — the `algorithmLine` is the only addition; the body is NOT inlined. Document the result in your report.

- [ ] **Step 6: Manual smoke (PENDING — list, do NOT attempt in this environment)**

The Electron app cannot be run by a subagent. In the report, list these PENDING steps for the human:
1. Launch the app. Spawn an agent. Inspect the agent's system prompt (transcript log) — confirm the `algorithm` L0 line appears in the "Your skills" section right after `operating-manual`.
2. Have the agent call `skill_read({ name: "algorithm" })` (via chat: "read your algorithm skill"). Confirm the full 7-phase body comes back.
3. Have the agent try `skill_create({ name: "algorithm", ... })`. Confirm it is rejected with the reserved-name error.
4. Force a verification failure on a goal with ISCs (the M13 PR-B1 smoke). After the inbox `verification_failed` lands, confirm a `verification.failed` activity event was recorded AND a derivation job was queued for the failure (check the derivation log / candidate inbox a few seconds later).
5. Achieve a goal whose ISCs include one that needed multiple attempts. Confirm the `goal_achieved` derivation prompt (in the derivation log) includes the criteria section with attempts counts.

- [ ] **Step 7: Final commit (only if Step 1 required edits)**

```bash
git add -A
git commit -m "test(algorithm): update count assertions"
```

---

## Self-Review (completed by plan author)

**Spec coverage (§8 + §15 row D + §11 + §16):**
- §8.1 (the 7 phases) → Task 1 (body names all 7 as `## ` headings; the test enforces order and content). ✓
- §8.2 (delivered as skill, not state machine; Operating Manual pointer; mode classifier text) → Tasks 1, 2 (constant + pointer paragraph). ✓
- §8.3 (VERIFY is the hard phase; `criterion_check` instruction) → Task 1 (`## 6. VERIFY` instructs `criterion_check` before `done`; test enforces). ✓
- §8.4 (hard-to-vary heuristic in THINK and VERIFY) → Task 1 (embedded in body; test enforces literal phrase). ✓
- §8.5 (LEARN feeds the M11 pipeline with richer signal — ISC outcomes; `verification_failed` as derivation trigger) → Tasks 5, 6, 7, 8, 9 (attempts counter + trail enrichment + prompt enrichment) AND Tasks 10, 11, 12, 13 (verification.failed activity event → dispatcher → trail → prompt → worker handler). ✓
- §10 row "Skills L0 += skill `algorithm`" → Task 3. ✓
- §10 row "ISA header" / "TELOS" / etc. → these are PR-A/PR-B/PR-C concerns, already shipped — no PR-D task needed.
- §11 token efficiency — Algorithm as L0 (~100 chars) only; body via `skill_read` → Task 3 + Task 14 step 5. ✓
- §15 row D scope items — all covered: Algorithm skill (constants + L0), pointer in Operating Manual, VERIFY → `criterion_check` (instruction in the body), LEARN: enriched payload on existing triggers + `verification_failed` as new trigger. ✓
- §16 testing — migration test, unit tests for trail/prompt/worker, exhaustive enum guard preserved. ✓

**Schema impact honest disclosure:** the spec's §8.5 example "ISC failed 3× then passed" requires per-attempt history. The current schema (`goal_criteria`) only stores the LAST result. Task 5 adds the smallest viable signal — a counter (`attempts`) — that lets us derive "passed first try" / "passed after N attempts" / "still failing after N attempts" without a separate history table. Full per-attempt details (timestamps + result for each attempt) are out of scope; if richer signal proves needed, a follow-up adds an `attempts_history_json` column.

**Placeholder scan:** every step that changes code shows the code. Where the plan tells the implementer to "match the file's existing idiom" (Task 4's `skill_search` field shape, Task 6's prepared-statement parameter style, Task 10's recorder API, Task 11's `ActivityEventRow` fields, Task 13's `processJob` signature), it is because the briefing notes the precise line/file but the surrounding code may have evolved — the implementer is told exactly which sibling to mirror.

**Type consistency:** `ALGORITHM_NAME` / `ALGORITHM_DESCRIPTION` / `ALGORITHM` defined Task 1, consumed Tasks 3, 4. `TrailCriterion` defined Task 7, reused Tasks 8, 9. `VerificationFailedTrail` defined Task 12, consumed Tasks 12 (prompt), 13 (worker). `DerivationJob` `"verification_failed"` variant added Task 11, handled Task 13 (worker's exhaustiveness guard is the safety net — the typecheck WILL fail between Task 11 and Task 13, that is called out in Task 11 step 4). `GoalCriterion.attempts` defined Task 6, consumed by the trail builders' SELECT projections in Tasks 7 and 8 (read directly off the row, not via the shared type — so a fixture-literal `GoalCriterion` without `attempts` only breaks main/renderer typecheck, which Task 6 step 4 catches).
