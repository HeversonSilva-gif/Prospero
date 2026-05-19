# M13 PR-B2 — Agent Verification Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents two MCP tools — `criterion_check` (run one deterministic ISC check as the auto-check of the Algorithm's VERIFY phase) and `criterion_judge` (a reviewer agent decides a judgment ISC) — both reusing the M13 PR-B1 verification engine.

**Architecture:** A new `checkOneCriterion` helper in `apps/main/src/verification/index.ts` resolves one criterion, builds a `VerifyContext`, runs `checkDeterministic`, and persists the result — the single-criterion analog of `runVerification`. The two MCP tools are added to the existing `isaToolDefinitions` array in `apps/main/src/mcp/tools-isa.ts` (auto-registered by the MCP server). `criterion_judge` is the agent-facing analog of B1's user `criterionJudge` IPC handler: `setJudgment(..., ctx.agentId)` then `reevaluateGoalFromState`.

**Tech Stack:** TypeScript, Electron, better-sqlite3, zod, MCP SDK, vitest.

**Spec:** `docs/superpowers/specs/2026-05-18-m13-outcome-verification-spine-design.md` — §8.3 (VERIFY is the hard phase), §12 (the MCP tools). M13 PR-A and PR-B1 are merged.

**Locked design decisions:**
- **`criterion_check` checks ONE criterion, does NOT run the goal gate.** It is the agent's per-criterion self-check while still working an issue (the goal is not `verifying` yet). It resolves the criterion, runs the deterministic check, persists via `applyResult`, returns the result.
- **`criterion_judge` mirrors B1's user `criterionJudge` IPC** — but `verified_by = ctx.agentId` (an agent, not the user) and it is an MCP tool. It calls `setJudgment` then `reevaluateGoalFromState` (which re-runs the gate).
- **Both tools are read-light, side-effecting, and non-FS** — auto-allowed, no `request_permission` gate, no capability (mirrors the M12 PR-D2 lesson: non-FS MCP tools are auto-allowed).
- Both enforce the cross-company guard (the criterion's goal must belong to `ctx.companyId`) — mirroring `isa_read`.
- `criterion_check` rejects a non-`deterministic` criterion; `criterion_judge` rejects a non-`judgment` criterion (defense-in-depth at the tool boundary — matches B1's `criterionJudge` IPC guard).
- **Out of B2:** the spec §12 `criterion_judge` `note` param is deferred — it is not load-bearing (the verdict drives the gate) and persisting a free-text note needs a schema decision; B2's `criterion_judge` takes `{ criterion_id, verdict }` only. The spec §13 GoalPlanReview ISC-coverage display is also deferred — it depends on a CEO-authors-`advancesCriteria` planning workflow that is not yet wired.

---

## File Structure

**Modified files:**
- `apps/main/src/verification/index.ts` — add `checkOneCriterion(db, criterionId, deps)`.
- `apps/main/src/verification/index.test.ts` — tests for `checkOneCriterion`.
- `apps/main/src/mcp/tools-isa.ts` — add `criterionCheck` and `criterionJudge` tools to `isaToolDefinitions`.
- `apps/main/src/mcp/tools-isa.test.ts` — tests for the two tools.

No migration, no new IPC channel, no `server.ts` change (the tools join the already-registered `isaToolDefinitions`).

---

## Task 1: checkOneCriterion — single-criterion verification helper

**Files:**
- Modify: `apps/main/src/verification/index.ts`
- Modify: `apps/main/src/verification/index.test.ts`

> Read `apps/main/src/verification/index.ts` first — confirm the imports already present (`createGoalsRepository`, `createGoalCriteriaRepository`, `runGoalVerification`, `runSandboxedCommand`, `VerifyContext`, `RunVerificationDeps`, `CriterionResult`). `checkDeterministic` from `./checks.js` is NOT yet imported there — add it.

- [ ] **Step 1: Write the failing test**

In `apps/main/src/verification/index.test.ts`, add inside the existing `describe` (it already has `db`/`companyId` in `beforeEach`, a `depsWith` helper, and imports `createGoalsRepository`/`createGoalCriteriaRepository`). Add `checkOneCriterion` to the import from `./index.js`:

```typescript
  it("checkOneCriterion runs a deterministic check and persists the result", async () => {
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    const crit = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "x", expectedExitCode: 0, timeoutMs: 1000 },
    });
    const result = await checkOneCriterion(db, crit.id, depsWith(0));
    expect(result.status).toBe("passed");
    expect(createGoalCriteriaRepository(db).getById(crit.id)?.status).toBe("passed");
  });

  it("checkOneCriterion persists a failing result", async () => {
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    const crit = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "x", expectedExitCode: 0, timeoutMs: 1000 },
    });
    const result = await checkOneCriterion(db, crit.id, depsWith(1));
    expect(result.status).toBe("failed");
    expect(createGoalCriteriaRepository(db).getById(crit.id)?.status).toBe("failed");
  });

  it("checkOneCriterion throws for an unknown criterion", async () => {
    await expect(checkOneCriterion(db, "nope", depsWith(0))).rejects.toThrow(/not found/);
  });

  it("checkOneCriterion throws for a judgment criterion", async () => {
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    const crit = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await expect(checkOneCriterion(db, crit.id, depsWith(0))).rejects.toThrow(/deterministic/);
  });
```

> Confirm `index.test.ts` already imports `createGoalsRepository` and `createGoalCriteriaRepository` (it does — the existing gate tests use them) and has a `depsWith(exitCode)` helper returning `RunVerificationDeps`. If `depsWith` is named differently, use the real name.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test verification/index`
Expected: FAIL — `checkOneCriterion is not exported` / not a function.

- [ ] **Step 3: Implement `checkOneCriterion`**

In `apps/main/src/verification/index.ts`:

1. Add `checkDeterministic` to the import from `./checks.js` (keep the existing `VerifyContext` type import):
```typescript
import { checkDeterministic } from "./checks.js";
import type { VerifyContext } from "./checks.js";
```
(If the file already imports `VerifyContext` as a type-only import, just add the value import for `checkDeterministic` on its own line.)

2. Add the exported function (place it after `runVerification`, before `recoverStuckVerifications`):
```typescript
// Runs the deterministic check for ONE criterion and persists the result.
// The single-criterion analog of runVerification — it does NOT run the goal
// gate (the agent calls this to self-check an ISC while still working an
// issue; the goal is not yet `verifying`). Throws for an unknown criterion
// or a judgment criterion (judgment is resolved by criterion_judge, not here).
export const checkOneCriterion = async (
  db: Database.Database,
  criterionId: string,
  deps: RunVerificationDeps,
): Promise<CriterionResult> => {
  const criteriaRepo = createGoalCriteriaRepository(db);
  const criterion = criteriaRepo.getById(criterionId);
  if (criterion === null) throw new Error(`criterion not found: ${criterionId}`);
  if (criterion.kind !== "deterministic") {
    throw new Error(`criterion ${criterionId} is not a deterministic criterion`);
  }
  const goal = createGoalsRepository(db).getById(criterion.goalId);
  if (goal === null) throw new Error(`goal not found: ${criterion.goalId}`);
  const ctx: VerifyContext = {
    db,
    sandboxRoot: deps.sandboxRootFor(goal),
    runCommand: deps.runCommand ?? runSandboxedCommand,
    callMetricTool: deps.callMetricTool,
  };
  const result = await checkDeterministic(criterion, ctx);
  criteriaRepo.applyResult(result);
  return result;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test verification/index`
Expected: PASS — the 4 new tests plus the existing gate tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/verification/index.ts apps/main/src/verification/index.test.ts
git commit -m "feat(verification): add checkOneCriterion single-criterion helper"
```

---

## Task 2: criterion_check MCP tool

**Files:**
- Modify: `apps/main/src/mcp/tools-isa.ts`
- Modify: `apps/main/src/mcp/tools-isa.test.ts`

> Read `apps/main/src/mcp/tools-isa.ts` (the current `isa_read` tool + the `Tool` type + the `isaToolDefinitions` array) and `apps/main/src/mcp/tools-isa.test.ts` (the `setup()` helper returning `{ ctx, goalId }`). Confirm `buildVerificationDeps` is exported from `apps/main/src/verification/deps.js` and takes no arguments.

- [ ] **Step 1: Write the failing test**

In `apps/main/src/mcp/tools-isa.test.ts`, add — using `artifact_exists` criteria so the test does NOT spawn a real process (the `command` path is already covered by Task 1 and the B1 sandbox tests). Add the imports it needs (`createGoalCriteriaRepository` is likely already imported; add `createIssuesRepository` and `createArtifactsRepository`):

```typescript
const criterionCheck = isaToolDefinitions.find((t) => t.name === "criterion_check")!;

describe("criterion_check tool", () => {
  it("runs a deterministic check and returns + persists the result", async () => {
    const { ctx, goalId } = setup();
    const issue = createIssuesRepository(ctx.db).create({
      companyId: ctx.companyId,
      title: "I",
      projectId: null,
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    ctx.db.prepare("UPDATE issues SET goal_id = ? WHERE id = ?").run(goalId, issue.id);
    createArtifactsRepository(ctx.db).create({
      issueId: issue.id,
      kind: "file_path",
      ref: "out/report.md",
      contentPreview: null,
      createdBy: null,
    });
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "report delivered",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    const out = JSON.parse(await criterionCheck.run({ criterion_id: crit.id }, ctx)) as {
      status: string;
    };
    expect(out.status).toBe("passed");
    expect(createGoalCriteriaRepository(ctx.db).getById(crit.id)?.status).toBe("passed");
  });

  it("returns a failed result when the check does not pass", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "report delivered",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "pr_url" },
    });
    const out = JSON.parse(await criterionCheck.run({ criterion_id: crit.id }, ctx)) as {
      status: string;
    };
    expect(out.status).toBe("failed");
  });

  it("rejects a judgment criterion", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await expect(criterionCheck.run({ criterion_id: crit.id }, ctx)).rejects.toThrow(
      /deterministic/,
    );
  });

  it("rejects a criterion from another company", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "x",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    await expect(
      criterionCheck.run({ criterion_id: crit.id }, { ...ctx, companyId: "other" }),
    ).rejects.toThrow(/not found/);
  });
});
```

> Adjust the `createIssuesRepository`/`createArtifactsRepository` `create({...})` field lists to the real input shapes (match a sibling test — the same shapes appear in `apps/main/src/verification/checks.test.ts`). Add any missing imports to the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test tools-isa`
Expected: FAIL — `criterion_check` not found in `isaToolDefinitions` (`.find(...)` returns undefined → the `!` yields a runtime error).

- [ ] **Step 3: Implement the tool**

In `apps/main/src/mcp/tools-isa.ts`:

1. Add imports:
```typescript
import { checkOneCriterion } from "../verification/index.js";
import { buildVerificationDeps } from "../verification/deps.js";
```

2. Define the `criterionCheck` tool (after `isaRead`, before the `isaToolDefinitions` export):
```typescript
// criterion_check — runs the deterministic check of ONE ISC and persists the
// result. The auto-check of the Algorithm's VERIFY phase: an agent calls this
// on its issue's criteria before marking the issue done. It does not transition
// the goal — the goal gate runs later, when all issues finish (M13 PR-B1).
const criterionCheck: Tool = {
  name: "criterion_check",
  description:
    "Run the deterministic check of one verifiable criterion (ISC) — a command, an artifact check, or a metric — and get whether it passed or failed. Use this to self-verify your work before marking an issue done. Only works on deterministic criteria; judgment criteria are decided with criterion_judge.",
  inputSchema: z.object({
    criterion_id: z.string().min(1).max(120),
  }),
  run: async (input, ctx) => {
    const { criterion_id } = criterionCheck.inputSchema.parse(input) as { criterion_id: string };
    const criterion = createGoalCriteriaRepository(ctx.db).getById(criterion_id);
    if (criterion === null) throw new Error(`criterion not found: ${criterion_id}`);
    const goal = createGoalsRepository(ctx.db).getById(criterion.goalId);
    if (goal === null || goal.companyId !== ctx.companyId) {
      throw new Error(`criterion not found: ${criterion_id}`);
    }
    const result = await checkOneCriterion(ctx.db, criterion_id, buildVerificationDeps());
    return JSON.stringify({
      criterionId: result.criterionId,
      status: result.status,
      detail: result.detail,
    });
  },
};
```

3. Add `criterionCheck` to the `isaToolDefinitions` array:
```typescript
export const isaToolDefinitions: Tool[] = [isaRead, criterionCheck];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test tools-isa`
Expected: PASS — the 4 new `criterion_check` tests plus the existing `isa_read` tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/mcp/tools-isa.ts apps/main/src/mcp/tools-isa.test.ts
git commit -m "feat(verification): add criterion_check mcp tool"
```

---

## Task 3: criterion_judge MCP tool

**Files:**
- Modify: `apps/main/src/mcp/tools-isa.ts`
- Modify: `apps/main/src/mcp/tools-isa.test.ts`

> Read B1's user `criterionJudge` IPC handler in `apps/main/src/ipc/isa-handlers.ts` — this MCP tool is its agent-facing analog. Confirm `reevaluateGoalFromState` is exported from `apps/main/src/verification/index.js` and `setJudgment` is on `GoalCriteriaRepository`.

- [ ] **Step 1: Write the failing test**

In `apps/main/src/mcp/tools-isa.test.ts`, add (the `setup()` helper's `ctx` has `agentId: "agent_1"` — used as `verified_by`):

```typescript
const criterionJudge = isaToolDefinitions.find((t) => t.name === "criterion_judge")!;

describe("criterion_judge tool", () => {
  // Walk a goal to `verifying` so reevaluateGoalFromState has something to gate.
  const toVerifying = (ctx: ToolContext, goalId: string): void => {
    const repo = createGoalsRepository(ctx.db);
    for (const s of ["planning", "proposed", "approved", "in_progress", "verifying"] as const) {
      repo.updateStatus(goalId, s);
    }
  };

  it("records the verdict with the agent as verifier and re-evaluates the goal", async () => {
    const { ctx, goalId } = setup();
    toVerifying(ctx, goalId);
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await criterionJudge.run({ criterion_id: crit.id, verdict: "passed" }, ctx);
    const fetched = createGoalCriteriaRepository(ctx.db).getById(crit.id);
    expect(fetched?.status).toBe("passed");
    expect(fetched?.verifiedBy).toBe("agent_1");
    // the only criterion is now passed -> the goal gate moves it to achieved
    expect(createGoalsRepository(ctx.db).getById(goalId)?.status).toBe("achieved");
  });

  it("rejects a deterministic criterion", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    await expect(
      criterionJudge.run({ criterion_id: crit.id, verdict: "passed" }, ctx),
    ).rejects.toThrow(/judgment/);
  });

  it("rejects an unknown criterion", async () => {
    const { ctx } = setup();
    await expect(
      criterionJudge.run({ criterion_id: "nope", verdict: "passed" }, ctx),
    ).rejects.toThrow(/not found/);
  });

  it("rejects a criterion from another company", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await expect(
      criterionJudge.run({ criterion_id: crit.id, verdict: "passed" }, { ...ctx, companyId: "other" }),
    ).rejects.toThrow(/not found/);
  });
});
```

> Confirm the test file imports `ToolContext` (it does — `tools-isa.test.ts` from B1 imports it) and `createGoalsRepository`. Add `createGoalsRepository` if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test tools-isa`
Expected: FAIL — `criterion_judge` not found in `isaToolDefinitions`.

- [ ] **Step 3: Implement the tool**

In `apps/main/src/mcp/tools-isa.ts`:

1. Add the import:
```typescript
import { reevaluateGoalFromState } from "../verification/index.js";
```
(Merge with the existing `../verification/index.js` import from Task 2 — one line: `import { checkOneCriterion, reevaluateGoalFromState } from "../verification/index.js";`.)

2. Define the `criterionJudge` tool (after `criterionCheck`):
```typescript
// criterion_judge — a reviewer agent decides a judgment ISC. Records the
// verdict with the agent as verifier, then re-evaluates the goal's gate
// (the goal may now be fully verified). The agent-facing analog of the
// user's criterion-judge action (M13 PR-B1).
const criterionJudge: Tool = {
  name: "criterion_judge",
  description:
    "Decide a judgment criterion (ISC) of a goal — pass, fail, or waive it. Use this when you have been asked to review a goal's judgment criteria. Records you as the verifier and re-checks whether the goal is fully verified.",
  inputSchema: z.object({
    criterion_id: z.string().min(1).max(120),
    verdict: z.enum(["passed", "failed", "waived"]),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { criterion_id, verdict } = criterionJudge.inputSchema.parse(input) as {
      criterion_id: string;
      verdict: "passed" | "failed" | "waived";
    };
    const criteriaRepo = createGoalCriteriaRepository(ctx.db);
    const criterion = criteriaRepo.getById(criterion_id);
    if (criterion === null) throw new Error(`criterion not found: ${criterion_id}`);
    const goal = createGoalsRepository(ctx.db).getById(criterion.goalId);
    if (goal === null || goal.companyId !== ctx.companyId) {
      throw new Error(`criterion not found: ${criterion_id}`);
    }
    if (criterion.kind !== "judgment") {
      throw new Error(`criterion ${criterion_id} is not a judgment criterion`);
    }
    criteriaRepo.setJudgment(criterion_id, verdict, ctx.agentId);
    reevaluateGoalFromState(ctx.db, criterion.goalId);
    return JSON.stringify({ criterionId: criterion_id, verdict });
  },
};
```

3. Add `criterionJudge` to the `isaToolDefinitions` array:
```typescript
export const isaToolDefinitions: Tool[] = [isaRead, criterionCheck, criterionJudge];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test tools-isa`
Expected: PASS — the 4 new `criterion_judge` tests plus all earlier `isa_read` + `criterion_check` tests.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/main lint`
Expected: clean. (Note: `criterion_judge`'s `run` is `async` but contains no `await` — the `eslint-disable-next-line @typescript-eslint/require-await` above it matches how `isa_read` handles the same lint rule. Keep it.)

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/mcp/tools-isa.ts apps/main/src/mcp/tools-isa.test.ts
git commit -m "feat(verification): add criterion_judge mcp tool"
```

---

## Task 4: Full verification + non-regression

**Files:** none (verification only).

- [ ] **Step 1: Check for an MCP tool-count assertion test**

M13 PR-B2 adds 2 MCP tools (`criterion_check`, `criterion_judge`). Search the test suites for any test asserting an exact COUNT of MCP tools (grep `*.test.ts` for `toolDefinitions` near `toHaveLength` / `.length).toBe(`). If one exists and now fails, update the expected number. If none exists (the M13 PR-A work found none), note that and move on.

- [ ] **Step 2: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: clean across all 4 packages.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: every package green (the 2 pre-existing `todo` tests in `apps/main` are fine). Confirm the `tools-isa` and `verification/index` suites pass with the new tests.

- [ ] **Step 5: Manual smoke (record results, do not skip silently)**

This needs the app running and a configured agent. Verify:
1. An agent (e.g. via a chat turn) can call `criterion_check` on a deterministic ISC of a goal it works on, and the criterion's status updates (visible in the ISA panel).
2. A reviewer agent can call `criterion_judge` on a pending judgment ISC; the criterion shows the verdict, `verifiedBy` is the agent, and a goal whose last pending criterion is now resolved moves to Achieved.

Record what passed and what did not. If the environment cannot exercise live agent tool calls, say so explicitly rather than claiming success.

- [ ] **Step 6: Final commit (only if Step 1 required edits)**

```bash
git add -A
git commit -m "test(verification): update mcp tool count assertion"
```

---

## Self-Review (completed by plan author)

**Spec coverage (spec §12, §8.3):**
- `criterion_check` MCP tool (the VERIFY-phase auto-check) → Task 2. ✓
- `criterion_judge` MCP tool (reviewer agent decides a judgment ISC, records `verified_by`) → Task 3. ✓
- Both reuse the B1 engine (`checkDeterministic`/`applyResult` via `checkOneCriterion`; `setJudgment`/`reevaluateGoalFromState`) — no duplicated verification logic. ✓
- Cross-company guard + kind guard on both tools. ✓

**Deferred (correctly out of B2 scope, communicated):** the `criterion_judge` `note` param (not load-bearing; needs a persistence decision); the GoalPlanReview ISC-coverage display (spec §13 — depends on a CEO-authors-`advancesCriteria` workflow not yet wired). After B2, M13 continues with PR-C (TELOS), PR-D (Algorithm — which wires `criterion_check` into the VERIFY phase as a skill instruction), PR-E (Containment Zones), PR-F.

**Type consistency:** `checkOneCriterion(db, criterionId, deps)` defined in Task 1, used in Task 2. `RunVerificationDeps` / `VerifyContext` / `CriterionResult` are B1 types reused unchanged. The `Tool` type is the file-local type in `tools-isa.ts`. `criterion_check` returns `{ criterionId, status, detail }`; `criterion_judge` returns `{ criterionId, verdict }` — consistent with each task's test assertions.

**No placeholders.** Every step has complete code. Open items the executor confirms against the codebase: the exact `index.test.ts` `depsWith` helper name; the `createIssuesRepository`/`createArtifactsRepository` create-input field lists; whether `tools-isa.test.ts` already imports `ToolContext`/`createGoalsRepository`; whether a tool-count test exists.
