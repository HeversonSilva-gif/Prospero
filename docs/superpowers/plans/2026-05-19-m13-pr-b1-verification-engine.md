# M13 PR-B1 — Verification Engine & Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When every issue of a goal reaches `done`/`cancelled`, the goal enters a new `verifying` status, its deterministic ISCs (criteria) are auto-checked, and the goal advances to `achieved` only if all checks pass — otherwise it bounces back to `in_progress` with an inbox card naming the failure. Judgment criteria are resolved by the user.

**Architecture:** A new `apps/main/src/verification/` module mirrors the structure of `apps/main/src/derivation/`. `runGoalVerification` reads a goal's `goal_criteria`, runs each deterministic check (`command` via a sandboxed child process, `artifact_exists` via SQL, `metric` via an in-process Prospero MCP tool call), persists results, and returns a `VerificationReport`. A gate function applies the report: all-pass → `achieved`; any fail → `in_progress` + `verification_failed` inbox; pending judgment → stays `verifying` + `verification_review` inbox. The issue-`done` IPC handler triggers it; a boot scan recovers goals stuck in `verifying`.

**Tech Stack:** TypeScript, Electron, better-sqlite3, `node:child_process` / `cross-spawn`, zod (main/renderer only), React + zustand + Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-05-18-m13-outcome-verification-spine-design.md` — §5.3, §6, §13, §14, §16, §17. PR-A is merged (`docs/superpowers/plans/2026-05-19-m13-pr-a-isa.md`).

**Locked design decisions:**
- **`verifying` status** is added to the `GoalStatus` TS union only — `goals.status` has no CHECK constraint, so no migration for it (spec §5.1 note).
- **`runGoalVerification` is async and fire-and-forget.** The issue-`done` trigger transitions the goal to `verifying` synchronously, then calls `void runVerification(...)`. A boot scan (`recoverStuckVerifications`) re-runs goals left in `verifying` after a crash/restart.
- **`checkMetric`** invokes a **Prospero MCP tool** resolved by name from the in-process tool registry. External MCP servers (e.g. a real `ads_get_insights`) as metric sources are **out of scope for B1** — a metric whose `tool` is not in the Prospero registry fails the check with a clear `detail`.
- **`advancesCriteria`** on `IssueToCreate` is `string[]` of **existing `goal_criteria` ids** (criteria are authored beforehand via the PR-A ISA panel), not indices into plan-proposed criteria. It is **optional** (`.optional()` in zod — the M12 PR-D4 lesson: optional, not `.default([])`, to not break existing plan literals).
- **One migration `0028`** does both the `issue_criteria` CREATE and the `inbox_items` recreate (2 new kinds).
- **Judgment ISC resolution in B1 is user-driven** — an IPC handler + a button in the ISA panel. The agent-facing `criterion_judge` tool is B2.
- The verification check functions take **injected** `runCommand` / `callMetricTool` deps so they unit-test without spawning processes.
- Out of B1: `criterion_check`/`criterion_judge` MCP tools, the GoalPlanReview ISC-coverage display, the LEARN/derivation enrichment (those are B2 / PR-D).

---

## File Structure

**New files:**
- `packages/shared/src/types/verification.ts` — `CriterionResult`, `VerificationReport`.
- `apps/main/src/db/migrations/0028_m13_verification.sql` (+ `0028.test.ts`).
- `apps/main/src/goals/issue-criteria-repository.ts` (+ `.test.ts`) — the `issue_criteria` join.
- `apps/main/src/verification/sandbox.ts` (+ `.test.ts`) — `runSandboxedCommand`, `minimalVerificationEnv`.
- `apps/main/src/verification/checks.ts` (+ `.test.ts`) — `checkArtifact`/`checkCommand`/`checkMetric`/`checkDeterministic`.
- `apps/main/src/verification/engine.ts` (+ `.test.ts`) — `runGoalVerification`.
- `apps/main/src/verification/index.ts` (+ `.test.ts`) — the gate + `runVerification` + `recoverStuckVerifications`.
- `apps/main/tests/verification-trigger.test.ts` — the issue-done → verifying integration test.

**Modified files:**
- `packages/shared/src/types/goal.ts` — `GoalStatus` += `verifying`; `IssueToCreate` += `advancesCriteria?`.
- `packages/shared/src/types/inbox.ts` — `InboxKind` += 2.
- `packages/shared/src/index.ts` (or `types/index.ts`) — export `verification.ts`.
- `apps/main/src/goals/repository.ts` — `ALLOWED_TRANSITIONS`.
- `apps/main/src/issues/repository.ts` — `listByGoal`.
- `apps/main/src/goals/criteria-repository.ts` — `applyResult`, `setJudgment`.
- `apps/main/src/schemas/goalPlan.ts` — `advancesCriteria`.
- `apps/main/src/goals/executor.ts` + `apps/main/src/mcp/tools-goals.ts` — populate `issue_criteria`.
- `apps/main/src/ipc/issues-handlers.ts` — issue-done verification trigger.
- `apps/main/src/ipc/isa-handlers.ts` + `packages/shared/src/ipc-channels.ts` + `apps/main/src/ipc/preload.ts` + the `window.prospero` type — the criterion-judge handler.
- `apps/main/src/ipc/handlers.ts` (or boot path) — call `recoverStuckVerifications`.
- `apps/renderer/src/stores/isa.ts` — `judgeCriterion`.
- `apps/renderer/src/components/IsaPanel.tsx` — criterion status display + judge button.
- `apps/renderer/src/routes/GoalDetail.tsx` — `verifying` status badge.
- `apps/renderer/src/routes/Inbox.tsx` — cards for the 2 new kinds.
- `apps/renderer/src/i18n/en-US.json` + `pt-BR.json`.

---

## Task 1: Shared types — verifying status, verification report, inbox kinds

**Files:**
- Modify: `packages/shared/src/types/goal.ts`
- Modify: `packages/shared/src/types/inbox.ts`
- Create: `packages/shared/src/types/verification.ts`
- Modify: the shared type barrel (`packages/shared/src/types/index.ts`)
- Create: `packages/shared/src/types/verification.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/types/verification.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { CriterionResult, VerificationReport } from "./verification.js";

describe("verification types", () => {
  it("CriterionResult and VerificationReport are usable", () => {
    const result: CriterionResult = {
      criterionId: "crit_1",
      status: "passed",
      detail: "exit 0",
      resultJson: { exitCode: 0 },
    };
    const report: VerificationReport = {
      goalId: "goal_1",
      allPassed: true,
      results: [result],
      pendingJudgment: [],
    };
    expect(report.results[0]!.status).toBe("passed");
    expect(report.allPassed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/shared test verification.test`
Expected: FAIL — `Cannot find module './verification.js'`.

- [ ] **Step 3: Create the verification types**

Create `packages/shared/src/types/verification.ts`:

```typescript
// M13 PR-B — verification engine result types. Pure types, no zod.

import type { CriterionStatus } from "./isa.js";

// The outcome of checking one ISC.
export interface CriterionResult {
  criterionId: string;
  status: CriterionStatus;
  // Human-readable one-liner, e.g. "exit 0" or "timeout 600000ms".
  detail: string;
  // Persisted to goal_criteria.last_result_json (stringified).
  resultJson: unknown;
}

// The outcome of verifying a whole goal.
export interface VerificationReport {
  goalId: string;
  allPassed: boolean;
  results: CriterionResult[];
  // ids of judgment ISCs still in 'pending' — the goal stays in `verifying`.
  pendingJudgment: string[];
}
```

- [ ] **Step 4: Add `verifying` to `GoalStatus` and `advancesCriteria` to `IssueToCreate`**

In `packages/shared/src/types/goal.ts`, change the `GoalStatus` union to insert `"verifying"` between `"in_progress"` and `"achieved"`:

```typescript
export type GoalStatus =
  | "draft"
  | "planning"
  | "proposed"
  | "approved"
  | "in_progress"
  | "verifying"
  | "achieved"
  | "cancelled";
```

In the same file, add `advancesCriteria` to the `IssueToCreate` interface (after `dependsOnIndexes`):

```typescript
  dependsOnIndexes: number[];
  // M13 — ids of goal_criteria (ISCs) this issue advances. Optional: existing
  // plans predate the field. Populated into the issue_criteria join on execute.
  advancesCriteria?: string[];
  rationale: string;
```

- [ ] **Step 5: Add the two inbox kinds**

In `packages/shared/src/types/inbox.ts`, add to the `InboxKind` union (after `budget_warning`):

```typescript
  | "budget_warning"
  | "verification_failed"
  | "verification_review";
```

- [ ] **Step 6: Export the new types**

In the shared type barrel — find where `./isa.js` is re-exported (it is, from PR-A; likely `packages/shared/src/types/index.ts`) and add next to it:

```typescript
export * from "./verification.js";
```

- [ ] **Step 7: Run test + typecheck**

Run: `pnpm --filter @prospero/shared test verification.test`
Expected: PASS — 1 test.
Run: `pnpm --filter @prospero/shared typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/verification.ts packages/shared/src/types/verification.test.ts packages/shared/src/types/goal.ts packages/shared/src/types/inbox.ts packages/shared/src/types/index.ts
git commit -m "feat(verification): add shared verification types and statuses"
```

---

## Task 2: Migration 0028 — issue_criteria + verification inbox kinds

**Files:**
- Create: `apps/main/src/db/migrations/0028_m13_verification.sql`
- Create: `apps/main/src/db/migrations/0028.test.ts`

> First confirm `0027_m13_isa_criteria.sql` is the highest migration. Read the most recent `inbox_items` recreate migration (`0026_m12_agent_budget_policy.sql`) and copy its FULL `inbox_items` column list + CHECK list — you must reproduce every existing kind and append the two new ones.

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/db/migrations/0028.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

type ColumnRow = { name: string };

describe("migration 0028 — verification", () => {
  it("creates issue_criteria with a composite key", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare("PRAGMA table_info(issue_criteria)").all() as ColumnRow[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("issue_id");
    expect(cols).toContain("criterion_id");
  });

  it("accepts the two new inbox kinds", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    for (const kind of ["verification_failed", "verification_review"]) {
      expect(() =>
        db
          .prepare(
            "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?,?,?,?,0,0)",
          )
          .run(`inb_${kind}`, "c1", kind, "t"),
      ).not.toThrow();
    }
  });

  it("still rejects an unknown inbox kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c2','Acme',0)").run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?,?,?,?,0,0)",
        )
        .run("inb_x", "c2", "bogus_kind", "t"),
    ).toThrow();
  });
});
```

> Verify the `companies` / `inbox_items` insert column lists against `0001_initial.sql` and the latest `inbox_items` recreate; adjust the seed inserts only if a NOT-NULL column without default is missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test 0028`
Expected: FAIL — `no such table: issue_criteria`.

- [ ] **Step 3: Write the migration**

Create `apps/main/src/db/migrations/0028_m13_verification.sql`. The `issue_criteria` block is fixed; the `inbox_items` recreate must reproduce **every column and every existing kind** from the latest recreate migration plus the two new kinds:

```sql
-- M13 PR-B1: issue_criteria join + verification_failed/verification_review inbox kinds.
--
-- issue_criteria links an issue to the ISCs it advances (spec §5.3) — used for
-- coverage hints and agent focus. The verification engine itself checks ALL of
-- a goal's goal_criteria and does not depend on this join.
--
-- SQLite cannot ALTER a CHECK constraint, so inbox_items is recreated to add
-- the two verification kinds. defer_foreign_keys per the M8 PR-A convention.

PRAGMA defer_foreign_keys = 1;

CREATE TABLE issue_criteria (
  issue_id      TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  criterion_id  TEXT NOT NULL REFERENCES goal_criteria(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, criterion_id)
);

CREATE INDEX idx_issue_criteria_criterion ON issue_criteria(criterion_id);

-- Recreate inbox_items with the two new kinds appended to the CHECK list.
CREATE TABLE inbox_items_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'approval','completed','suggestion','error','security_alert',
      'goal_proposed','goal_executing','goal_error','agent_unresponsive',
      'skill_candidate_pending','skill_promotion_requested',
      'goal_retrospective_ready','memory_review_needed','org_proposed',
      'budget_warning','verification_failed','verification_review'
    )),
  actor_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,
  requires_action INTEGER NOT NULL DEFAULT 0
    CHECK (requires_action IN (0,1)),
  approval_id TEXT REFERENCES approvals(id) ON DELETE SET NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

INSERT INTO inbox_items_new
  (id, company_id, kind, actor_id, title, preview, payload_json,
   requires_action, approval_id, read_at, created_at)
SELECT
  id, company_id, kind, actor_id, title, preview, payload_json,
  requires_action, approval_id, read_at, created_at
FROM inbox_items;

DROP TABLE inbox_items;
ALTER TABLE inbox_items_new RENAME TO inbox_items;
```

> **CRITICAL:** open `0026_m12_agent_budget_policy.sql` and diff the `inbox_items` column list + the kind CHECK list against the block above. The column list and every pre-existing kind MUST match exactly — if `0026`'s table has a column or kind not shown above, add it. Also re-create any index on `inbox_items` that `0026` (or earlier) created and that this recreate would drop (the project has a known tech-debt where `idx_inbox_company_unread` is dropped by each recreate — if `0026` creates such an index, reproduce it here with `CREATE INDEX`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test 0028`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/db/migrations/0028_m13_verification.sql apps/main/src/db/migrations/0028.test.ts
git commit -m "feat(verification): add issue_criteria table and verification inbox kinds"
```

---

## Task 3: Goal status transitions — allow verifying

**Files:**
- Modify: `apps/main/src/goals/repository.ts`
- Modify: `apps/main/src/goals/repository.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/main/src/goals/repository.test.ts`, add inside the `describe("goalsRepository", ...)` block:

```typescript
  it("allows in_progress -> verifying -> achieved", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "Launch" });
    repo.updateStatus(goal.id, "planning");
    repo.updateStatus(goal.id, "proposed");
    repo.updateStatus(goal.id, "approved");
    repo.updateStatus(goal.id, "in_progress");
    repo.updateStatus(goal.id, "verifying");
    repo.updateStatus(goal.id, "achieved");
    expect(repo.getById(goal.id)?.status).toBe("achieved");
  });

  it("allows verifying -> in_progress (verification bounce-back)", () => {
    const repo = createGoalsRepository(db);
    const goal = repo.create({ companyId, title: "Launch" });
    repo.updateStatus(goal.id, "planning");
    repo.updateStatus(goal.id, "proposed");
    repo.updateStatus(goal.id, "approved");
    repo.updateStatus(goal.id, "in_progress");
    repo.updateStatus(goal.id, "verifying");
    repo.updateStatus(goal.id, "in_progress");
    expect(repo.getById(goal.id)?.status).toBe("in_progress");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test goals/repository`
Expected: FAIL — the `in_progress -> verifying` transition is rejected.

- [ ] **Step 3: Update `ALLOWED_TRANSITIONS`**

In `apps/main/src/goals/repository.ts`, change the `ALLOWED_TRANSITIONS` map:

```typescript
const ALLOWED_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["proposed", "cancelled"],
  proposed: ["planning", "approved", "cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["verifying", "achieved", "cancelled"],
  verifying: ["achieved", "in_progress", "cancelled"],
  achieved: [],
  cancelled: [],
};
```

(`in_progress → achieved` is kept so existing direct-achieve paths still work; `verifying` bounces to `in_progress` on failure or advances to `achieved`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test goals/repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/goals/repository.ts apps/main/src/goals/repository.test.ts
git commit -m "feat(verification): allow the verifying goal status transitions"
```

---

## Task 4: Issues repository — listByGoal

**Files:**
- Modify: `apps/main/src/issues/repository.ts`
- Modify: `apps/main/src/issues/repository.test.ts` (or wherever the issues-repo test lives — confirm)

> Read `apps/main/src/issues/repository.ts` to confirm the `IssuesRepository` type, the `rowToIssue` mapper, and the prepared-statement style. Confirm where its test file is.

- [ ] **Step 1: Write the failing test**

In the issues-repository test file, add a test (adapt the seed helpers to the file's existing ones — it needs a company, a goal, and issues):

```typescript
  it("listByGoal returns the goal's issues ordered by created_at", () => {
    const repo = createIssuesRepository(db);
    // create a goal + two issues linked to it, and one unlinked issue.
    // (use the file's existing company/goal/issue seed helpers)
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    const a = repo.create({ companyId, title: "first", /* required fields */ });
    const b = repo.create({ companyId, title: "second", /* required fields */ });
    repo.create({ companyId, title: "unlinked", /* required fields */ });
    db.prepare("UPDATE issues SET goal_id = ? WHERE id IN (?, ?)").run(goalId, a.id, b.id);
    const linked = repo.listByGoal(goalId);
    expect(linked.map((i) => i.title)).toEqual(["first", "second"]);
  });
```

> Fill the `create({...})` calls with whatever required fields `CreateIssueInput` needs — match an existing `repo.create` call in the same test file. The point is: 2 issues linked to the goal, 1 not.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test issues/repository`
Expected: FAIL — `repo.listByGoal is not a function`.

- [ ] **Step 3: Implement `listByGoal`**

In `apps/main/src/issues/repository.ts`:

1. Add to the `IssuesRepository` type:
```typescript
  listByGoal(goalId: string): Issue[];
```
2. Add a prepared statement near the others:
```typescript
  const listByGoalStmt = db.prepare(
    "SELECT * FROM issues WHERE goal_id = ? ORDER BY created_at ASC, id ASC",
  );
```
3. Add the method to the returned object, using the file's existing `rowToIssue` mapper:
```typescript
    listByGoal: (goalId) => (listByGoalStmt.all(goalId) as IssueRow[]).map(rowToIssue),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test issues/repository`
Expected: PASS.

- [ ] **Step 5: Check for broken `IssuesRepository` mocks**

Run: `pnpm --filter @prospero/main typecheck`
If a literal `IssuesRepository` mock in `apps/main/tests/` fails to compile, add `listByGoal: () => []` to it. Fix every one the typecheck flags.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/issues/repository.ts apps/main/src/issues
git commit -m "feat(verification): add issues listByGoal query"
```

---

## Task 5: Criteria repository — applyResult and setJudgment

**Files:**
- Modify: `apps/main/src/goals/criteria-repository.ts`
- Modify: `apps/main/src/goals/criteria-repository.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/main/src/goals/criteria-repository.test.ts`, add inside the `describe` block:

```typescript
  it("applyResult persists status, timestamp and result json", () => {
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({ goalId, statement: "tests pass", kind: "deterministic" });
    repo.applyResult({
      criterionId: c.id,
      status: "failed",
      detail: "exit 1",
      resultJson: { exitCode: 1 },
    });
    const fetched = repo.getById(c.id);
    expect(fetched?.status).toBe("failed");
    expect(fetched?.lastCheckedAt).not.toBeNull();
    expect(fetched?.lastResultJson).toBe(JSON.stringify({ exitCode: 1 }));
  });

  it("setJudgment persists status and verifiedBy", () => {
    const repo = createGoalCriteriaRepository(db);
    const c = repo.create({ goalId, statement: "on brand", kind: "judgment" });
    repo.setJudgment(c.id, "passed", "agent_1");
    const fetched = repo.getById(c.id);
    expect(fetched?.status).toBe("passed");
    expect(fetched?.verifiedBy).toBe("agent_1");
    expect(fetched?.lastCheckedAt).not.toBeNull();
  });
```

> The `applyResult` test needs `agent_1` to exist only for `setJudgment` (FK `verified_by → agents`). Seed an agent in `beforeEach` or in the test — confirm how the file seeds an agent; if it doesn't, create one via the agents repo. If seeding an agent is heavy, pass `null` as `verifiedBy` and assert on a non-FK path instead — but prefer seeding a real agent.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test criteria-repository`
Expected: FAIL — `repo.applyResult is not a function`.

- [ ] **Step 3: Implement the two methods**

In `apps/main/src/goals/criteria-repository.ts`:

1. Add to the `GoalCriteriaRepository` type:
```typescript
  applyResult(result: {
    criterionId: string;
    status: CriterionStatus;
    detail: string;
    resultJson: unknown;
  }): void;
  setJudgment(id: string, status: CriterionStatus, verifiedBy: string | null): void;
```
2. Add prepared statements near the others:
```typescript
  const applyResultStmt = db.prepare(`
    UPDATE goal_criteria SET
      status = @status, last_checked_at = @checkedAt,
      last_result_json = @resultJson, updated_at = @updatedAt
    WHERE id = @id
  `);
  const setJudgmentStmt = db.prepare(`
    UPDATE goal_criteria SET
      status = @status, verified_by = @verifiedBy,
      last_checked_at = @checkedAt, updated_at = @updatedAt
    WHERE id = @id
  `);
```
3. Add the implementations and include them in the returned object:
```typescript
  const applyResult: GoalCriteriaRepository["applyResult"] = (result) => {
    const now = Date.now();
    applyResultStmt.run({
      id: result.criterionId,
      status: result.status,
      checkedAt: now,
      resultJson: JSON.stringify(result.resultJson),
      updatedAt: now,
    });
  };
  const setJudgment: GoalCriteriaRepository["setJudgment"] = (id, status, verifiedBy) => {
    const now = Date.now();
    setJudgmentStmt.run({ id, status, verifiedBy, checkedAt: now, updatedAt: now });
  };
```
Add `applyResult` and `setJudgment` to the returned object. Import `CriterionStatus` from `@prospero/shared` if not already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test criteria-repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/goals/criteria-repository.ts apps/main/src/goals/criteria-repository.test.ts
git commit -m "feat(verification): add criteria applyResult and setJudgment"
```

---

## Task 6: issue_criteria join repository

**Files:**
- Create: `apps/main/src/goals/issue-criteria-repository.ts`
- Create: `apps/main/src/goals/issue-criteria-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/goals/issue-criteria-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "./repository.js";
import { createGoalCriteriaRepository } from "./criteria-repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createIssueCriteriaRepository } from "./issue-criteria-repository.js";

describe("issueCriteriaRepository", () => {
  let db: Database.Database;
  let issueId: string;
  let critId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    critId = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
    }).id;
    issueId = createIssuesRepository(db).create({ companyId, title: "I" }).id;
  });

  it("link then listCriteriaForIssue round-trips", () => {
    const repo = createIssueCriteriaRepository(db);
    repo.link(issueId, critId);
    expect(repo.listCriteriaForIssue(issueId)).toEqual([critId]);
  });

  it("link is idempotent", () => {
    const repo = createIssueCriteriaRepository(db);
    repo.link(issueId, critId);
    repo.link(issueId, critId);
    expect(repo.listCriteriaForIssue(issueId)).toEqual([critId]);
  });

  it("listIssuesForCriterion returns the linked issues", () => {
    const repo = createIssueCriteriaRepository(db);
    repo.link(issueId, critId);
    expect(repo.listIssuesForCriterion(critId)).toEqual([issueId]);
  });
});
```

> Fill `createIssuesRepository(db).create({...})` with the required `CreateIssueInput` fields — match Task 4's usage.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test issue-criteria-repository`
Expected: FAIL — `Cannot find module './issue-criteria-repository.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/main/src/goals/issue-criteria-repository.ts`:

```typescript
import type Database from "better-sqlite3";

// The issue_criteria join: which ISCs an issue advances (spec §5.3).
export type IssueCriteriaRepository = {
  // Idempotent — links an issue to a criterion.
  link(issueId: string, criterionId: string): void;
  listCriteriaForIssue(issueId: string): string[];
  listIssuesForCriterion(criterionId: string): string[];
};

export const createIssueCriteriaRepository = (
  db: Database.Database,
): IssueCriteriaRepository => {
  const linkStmt = db.prepare(
    "INSERT OR IGNORE INTO issue_criteria (issue_id, criterion_id) VALUES (?, ?)",
  );
  const critsForIssueStmt = db.prepare(
    "SELECT criterion_id FROM issue_criteria WHERE issue_id = ?",
  );
  const issuesForCritStmt = db.prepare(
    "SELECT issue_id FROM issue_criteria WHERE criterion_id = ?",
  );
  return {
    link: (issueId, criterionId) => {
      linkStmt.run(issueId, criterionId);
    },
    listCriteriaForIssue: (issueId) =>
      (critsForIssueStmt.all(issueId) as { criterion_id: string }[]).map((r) => r.criterion_id),
    listIssuesForCriterion: (criterionId) =>
      (issuesForCritStmt.all(criterionId) as { issue_id: string }[]).map((r) => r.issue_id),
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test issue-criteria-repository`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/goals/issue-criteria-repository.ts apps/main/src/goals/issue-criteria-repository.test.ts
git commit -m "feat(verification): add issue_criteria join repository"
```

---

## Task 7: Sandboxed command runner

**Files:**
- Create: `apps/main/src/verification/sandbox.ts`
- Create: `apps/main/src/verification/sandbox.test.ts`

> First read `apps/main/src/derivation/runner.ts` to confirm how `cross-spawn` / `node:child_process` are imported and used in this codebase.

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/verification/sandbox.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runSandboxedCommand, minimalVerificationEnv } from "./sandbox.js";

describe("sandbox", () => {
  it("minimalVerificationEnv excludes secrets", () => {
    const env = minimalVerificationEnv();
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
  });

  it("captures a zero exit code and stdout", async () => {
    const r = await runSandboxedCommand({
      command: `node -e "console.log('ok'); process.exit(0)"`,
      cwd: process.cwd(),
      timeoutMs: 15000,
      env: minimalVerificationEnv(),
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ok");
    expect(r.timedOut).toBe(false);
  });

  it("reports a non-zero exit code", async () => {
    const r = await runSandboxedCommand({
      command: `node -e "process.exit(3)"`,
      cwd: process.cwd(),
      timeoutMs: 15000,
      env: minimalVerificationEnv(),
    });
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it("flags a timeout", async () => {
    const r = await runSandboxedCommand({
      command: `node -e "setTimeout(() => {}, 8000)"`,
      cwd: process.cwd(),
      timeoutMs: 400,
      env: minimalVerificationEnv(),
    });
    expect(r.timedOut).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test verification/sandbox`
Expected: FAIL — `Cannot find module './sandbox.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/main/src/verification/sandbox.ts`:

```typescript
// Sandboxed command execution for verification ISCs (spec §6.3, §17).
// Runs a user-authored command string through the platform shell, in the goal
// owner's sandbox directory, with a minimal (no-secrets) environment and a
// hard timeout. The cwd is fixed by the caller — never taken from the ISC.

import crossSpawn from "cross-spawn";

export interface SandboxedCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunSandboxedCommandInput {
  command: string;
  cwd: string;
  timeoutMs: number;
  env: Record<string, string>;
}

// A minimal environment for a verification command: PATH only, plus the
// Windows essentials. No OAuth token, no API key, no cloud credentials.
export const minimalVerificationEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  if (process.env["PATH"] !== undefined) env["PATH"] = process.env["PATH"];
  if (process.env["SystemRoot"] !== undefined) env["SystemRoot"] = process.env["SystemRoot"];
  if (process.env["PATHEXT"] !== undefined) env["PATHEXT"] = process.env["PATHEXT"];
  return env;
};

export const runSandboxedCommand = (
  input: RunSandboxedCommandInput,
): Promise<SandboxedCommandResult> =>
  new Promise((resolve) => {
    const child = crossSpawn(input.command, [], {
      cwd: input.cwd,
      env: input.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };
    child.on("error", () => finish(timedOut ? 124 : 1));
    child.on("close", (code) => finish(code ?? (timedOut ? 124 : 1)));
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test verification/sandbox`
Expected: PASS — 4 tests.
If the timeout test is flaky on Windows (the shell child not dying cleanly), report it as DONE_WITH_CONCERNS with the observed behavior — do NOT loosen the assertion. `timedOut` is set by our own timer before `child.kill()`, so it should be reliable even if the OS process lingers briefly.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/verification/sandbox.ts apps/main/src/verification/sandbox.test.ts
git commit -m "feat(verification): add sandboxed command runner"
```

---

## Task 8: Deterministic check functions

**Files:**
- Create: `apps/main/src/verification/checks.ts`
- Create: `apps/main/src/verification/checks.test.ts`

> Read `apps/main/src/artifacts/repository.ts` to confirm `createArtifactsRepository(db)` and its `listByIssue(issueId)` method.

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/verification/checks.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createArtifactsRepository } from "../artifacts/repository.js";
import { checkDeterministic } from "./checks.js";
import type { VerifyContext } from "./checks.js";
import type { GoalCriterion } from "@prospero/shared";

const baseCtx = (db: Database.Database): VerifyContext => ({
  db,
  sandboxRoot: process.cwd(),
  runCommand: () =>
    Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
  callMetricTool: () => Promise.resolve({}),
});

describe("checkDeterministic", () => {
  let db: Database.Database;
  let goalId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
  });

  const mkCriterion = (over: Partial<GoalCriterion>): GoalCriterion => {
    const c = createGoalCriteriaRepository(db).create({
      goalId,
      statement: over.statement ?? "x",
      kind: "deterministic",
      checkType: over.checkType ?? "command",
      checkSpec: over.checkSpec ?? {
        checkType: "command",
        command: "pnpm test",
        expectedExitCode: 0,
        timeoutMs: 1000,
      },
    });
    return c;
  };

  it("command check passes when the exit code matches", async () => {
    const c = mkCriterion({});
    const r = await checkDeterministic(c, baseCtx(db));
    expect(r.status).toBe("passed");
  });

  it("command check fails on a wrong exit code", async () => {
    const c = mkCriterion({});
    const ctx = {
      ...baseCtx(db),
      runCommand: () =>
        Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom", timedOut: false }),
    };
    const r = await checkDeterministic(c, ctx);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("exit 1");
  });

  it("command check fails on a timeout", async () => {
    const c = mkCriterion({});
    const ctx = {
      ...baseCtx(db),
      runCommand: () =>
        Promise.resolve({ exitCode: 124, stdout: "", stderr: "", timedOut: true }),
    };
    const r = await checkDeterministic(c, ctx);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("timeout");
  });

  it("metric check compares the numeric field with the operator", async () => {
    const c = mkCriterion({
      checkType: "metric",
      checkSpec: {
        checkType: "metric",
        tool: "fake_metric",
        params: {},
        field: "data.cpa",
        operator: "lt",
        threshold: 50,
      },
    });
    const passCtx = { ...baseCtx(db), callMetricTool: () => Promise.resolve({ data: { cpa: 30 } }) };
    expect((await checkDeterministic(c, passCtx)).status).toBe("passed");
    const failCtx = { ...baseCtx(db), callMetricTool: () => Promise.resolve({ data: { cpa: 80 } }) };
    expect((await checkDeterministic(c, failCtx)).status).toBe("failed");
  });

  it("metric check fails when the tool throws", async () => {
    const c = mkCriterion({
      checkType: "metric",
      checkSpec: {
        checkType: "metric",
        tool: "missing_tool",
        params: {},
        field: "x",
        operator: "eq",
        threshold: 1,
      },
    });
    const ctx = {
      ...baseCtx(db),
      callMetricTool: () => Promise.reject(new Error("tool not found")),
    };
    const r = await checkDeterministic(c, ctx);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("tool not found");
  });

  it("artifact_exists check passes when a matching artifact exists", async () => {
    const companyId = createGoalsRepository(db).getById(goalId)!.companyId;
    const issue = createIssuesRepository(db).create({ companyId, title: "I" });
    db.prepare("UPDATE issues SET goal_id = ? WHERE id = ?").run(goalId, issue.id);
    createArtifactsRepository(db).create({
      issueId: issue.id,
      kind: "file_path",
      ref: "out/report.md",
      contentPreview: null,
      createdBy: null,
    });
    const c = mkCriterion({
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    const r = await checkDeterministic(c, baseCtx(db));
    expect(r.status).toBe("passed");
  });

  it("artifact_exists check fails when no artifact matches", async () => {
    const c = mkCriterion({
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "pr_url" },
    });
    const r = await checkDeterministic(c, baseCtx(db));
    expect(r.status).toBe("failed");
  });
});
```

> Fill `createIssuesRepository(db).create({...})` / `createArtifactsRepository(db).create({...})` with the exact required fields of `CreateIssueInput` / the artifacts repo's create input — confirm against those repos and match.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test verification/checks`
Expected: FAIL — `Cannot find module './checks.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/main/src/verification/checks.ts`:

```typescript
// Deterministic ISC checks for the verification engine (spec §6.3).
// All three check kinds resolve to a CriterionResult. The command and metric
// runners are injected via VerifyContext so the checks unit-test without
// spawning processes or touching the MCP registry.

import type Database from "better-sqlite3";
import type {
  ArtifactCheckSpec,
  CommandCheckSpec,
  CriterionResult,
  GoalCriterion,
  MetricCheckSpec,
} from "@prospero/shared";
import { createIssuesRepository } from "../issues/repository.js";
import { createArtifactsRepository } from "../artifacts/repository.js";
import { minimalVerificationEnv } from "./sandbox.js";
import type { RunSandboxedCommandInput, SandboxedCommandResult } from "./sandbox.js";

export interface VerifyContext {
  db: Database.Database;
  // The goal owner's sandbox directory — where command checks run.
  sandboxRoot: string;
  runCommand: (input: RunSandboxedCommandInput) => Promise<SandboxedCommandResult>;
  // Resolves and invokes a Prospero MCP tool by name; throws if unavailable.
  callMetricTool: (tool: string, params: Record<string, unknown>) => Promise<unknown>;
}

const TRUNCATE = 4000;

const checkCommand = async (
  c: GoalCriterion,
  spec: CommandCheckSpec,
  ctx: VerifyContext,
): Promise<CriterionResult> => {
  const run = await ctx.runCommand({
    command: spec.command,
    cwd: ctx.sandboxRoot,
    timeoutMs: spec.timeoutMs,
    env: minimalVerificationEnv(),
  });
  const passed = !run.timedOut && run.exitCode === spec.expectedExitCode;
  const detail = run.timedOut
    ? `timeout ${spec.timeoutMs}ms`
    : passed
      ? `exit ${run.exitCode}`
      : `exit ${run.exitCode}, expected ${spec.expectedExitCode}`;
  return {
    criterionId: c.id,
    status: passed ? "passed" : "failed",
    detail,
    resultJson: {
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      stdout: run.stdout.slice(-TRUNCATE),
      stderr: run.stderr.slice(-TRUNCATE),
    },
  };
};

const getField = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc === "object" && acc !== null) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);

const compare = (op: MetricCheckSpec["operator"], a: number, b: number): boolean => {
  switch (op) {
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "eq":
      return a === b;
  }
};

const checkMetric = async (
  c: GoalCriterion,
  spec: MetricCheckSpec,
  ctx: VerifyContext,
): Promise<CriterionResult> => {
  let raw: unknown;
  try {
    raw = await ctx.callMetricTool(spec.tool, spec.params);
  } catch (err) {
    return {
      criterionId: c.id,
      status: "failed",
      detail: `metric tool error: ${err instanceof Error ? err.message : String(err)}`,
      resultJson: { error: err instanceof Error ? err.message : String(err) },
    };
  }
  const value = getField(raw, spec.field);
  if (typeof value !== "number" || Number.isNaN(value)) {
    return {
      criterionId: c.id,
      status: "failed",
      detail: `field "${spec.field}" is not a number`,
      resultJson: { value },
    };
  }
  const passed = compare(spec.operator, value, spec.threshold);
  return {
    criterionId: c.id,
    status: passed ? "passed" : "failed",
    detail: `${spec.field}=${value} ${spec.operator} ${spec.threshold}`,
    resultJson: { value, operator: spec.operator, threshold: spec.threshold },
  };
};

const checkArtifact = (
  c: GoalCriterion,
  spec: ArtifactCheckSpec,
  ctx: VerifyContext,
): CriterionResult => {
  const issues = createIssuesRepository(ctx.db).listByGoal(c.goalId);
  const artifactsRepo = createArtifactsRepository(ctx.db);
  const re = spec.refPattern !== undefined ? new RegExp(spec.refPattern) : null;
  for (const issue of issues) {
    for (const artifact of artifactsRepo.listByIssue(issue.id)) {
      if (artifact.kind === spec.artifactKind && (re === null || re.test(artifact.ref))) {
        return {
          criterionId: c.id,
          status: "passed",
          detail: `artifact ${artifact.kind}: ${artifact.ref}`,
          resultJson: { matched: true, ref: artifact.ref },
        };
      }
    }
  }
  return {
    criterionId: c.id,
    status: "failed",
    detail: `no ${spec.artifactKind} artifact found on this goal's issues`,
    resultJson: { matched: false },
  };
};

// Runs the deterministic check for one criterion. A deterministic criterion
// with no checkSpec is a malformed criterion — it fails.
export const checkDeterministic = async (
  c: GoalCriterion,
  ctx: VerifyContext,
): Promise<CriterionResult> => {
  const spec = c.checkSpec;
  if (spec === null) {
    return {
      criterionId: c.id,
      status: "failed",
      detail: "deterministic criterion has no check spec",
      resultJson: null,
    };
  }
  switch (spec.checkType) {
    case "command":
      return checkCommand(c, spec, ctx);
    case "metric":
      return checkMetric(c, spec, ctx);
    case "artifact_exists":
      return checkArtifact(c, spec, ctx);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test verification/checks`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/verification/checks.ts apps/main/src/verification/checks.test.ts
git commit -m "feat(verification): add deterministic isc check functions"
```

---

## Task 9: The verification engine — runGoalVerification

**Files:**
- Create: `apps/main/src/verification/engine.ts`
- Create: `apps/main/src/verification/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/verification/engine.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { runGoalVerification } from "./engine.js";
import type { VerifyContext } from "./checks.js";

const ctxWith = (db: Database.Database, exitCode: number): VerifyContext => ({
  db,
  sandboxRoot: process.cwd(),
  runCommand: () => Promise.resolve({ exitCode, stdout: "", stderr: "", timedOut: false }),
  callMetricTool: () => Promise.resolve({}),
});

describe("runGoalVerification", () => {
  let db: Database.Database;
  let goalId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
  });

  const addCommandCriterion = (): string =>
    createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "pnpm test", expectedExitCode: 0, timeoutMs: 1000 },
    }).id;

  it("a goal with no criteria passes trivially (back-compat)", async () => {
    const report = await runGoalVerification(goalId, ctxWith(db, 0));
    expect(report.allPassed).toBe(true);
    expect(report.results).toEqual([]);
    expect(report.pendingJudgment).toEqual([]);
  });

  it("all deterministic criteria passing yields allPassed and persists status", async () => {
    const critId = addCommandCriterion();
    const report = await runGoalVerification(goalId, ctxWith(db, 0));
    expect(report.allPassed).toBe(true);
    expect(createGoalCriteriaRepository(db).getById(critId)?.status).toBe("passed");
  });

  it("a failing deterministic criterion yields allPassed=false", async () => {
    addCommandCriterion();
    const report = await runGoalVerification(goalId, ctxWith(db, 1));
    expect(report.allPassed).toBe(false);
    expect(report.results.some((r) => r.status === "failed")).toBe(true);
  });

  it("a pending judgment criterion keeps the goal unverified", async () => {
    createGoalCriteriaRepository(db).create({ goalId, statement: "on brand", kind: "judgment" });
    const report = await runGoalVerification(goalId, ctxWith(db, 0));
    expect(report.allPassed).toBe(false);
    expect(report.pendingJudgment).toHaveLength(1);
  });

  it("a passed judgment criterion counts toward allPassed", async () => {
    const c = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    createGoalCriteriaRepository(db).setJudgment(c.id, "passed", null);
    const report = await runGoalVerification(goalId, ctxWith(db, 0));
    expect(report.allPassed).toBe(true);
    expect(report.pendingJudgment).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test verification/engine`
Expected: FAIL — `Cannot find module './engine.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/main/src/verification/engine.ts`:

```typescript
// The verification engine (spec §6.2). Reads a goal's criteria, runs each
// deterministic check (persisting its result), reads each judgment criterion's
// current status, and returns a VerificationReport. A goal with no criteria
// verifies trivially — this guarantees non-regression for pre-M13 goals.

import type { CriterionResult, VerificationReport } from "@prospero/shared";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { checkDeterministic } from "./checks.js";
import type { VerifyContext } from "./checks.js";

export const runGoalVerification = async (
  goalId: string,
  ctx: VerifyContext,
): Promise<VerificationReport> => {
  const criteriaRepo = createGoalCriteriaRepository(ctx.db);
  const criteria = criteriaRepo.listByGoal(goalId);

  if (criteria.length === 0) {
    return { goalId, allPassed: true, results: [], pendingJudgment: [] };
  }

  const results: CriterionResult[] = [];
  for (const c of criteria) {
    if (c.kind === "judgment") {
      // Judgment is not "run" — its status is whatever a reviewer/user set.
      results.push({
        criterionId: c.id,
        status: c.status,
        detail: `judgment: ${c.status}`,
        resultJson: null,
      });
      continue;
    }
    const result = await checkDeterministic(c, ctx);
    criteriaRepo.applyResult(result);
    results.push(result);
  }

  const pendingJudgment = results
    .filter((r) => r.status === "pending")
    .map((r) => r.criterionId);
  const allPassed = results.every((r) => r.status === "passed" || r.status === "waived");
  return { goalId, allPassed, results, pendingJudgment };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test verification/engine`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/verification/engine.ts apps/main/src/verification/engine.test.ts
git commit -m "feat(verification): add the goal verification engine"
```

---

## Task 10: The verification gate — apply report, run, recover

**Files:**
- Create: `apps/main/src/verification/index.ts`
- Create: `apps/main/src/verification/index.test.ts`

> Read `apps/main/src/inbox/repository.ts` (`createInboxRepository`, `CreateInboxInput`), `apps/main/src/orchestrator/util/paths.ts` (`getAgentSandboxCwd`), `apps/main/src/mcp/server.ts` (how the tool-definition arrays are assembled), and `apps/main/src/mcp/tools.ts` (the `ToolContext` shape).

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/verification/index.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { applyVerificationReport, runVerification } from "./index.js";
import type { RunVerificationDeps } from "./index.js";

const toVerifying = (db: Database.Database, companyId: string): string => {
  const repo = createGoalsRepository(db);
  const g = repo.create({ companyId, title: "G" });
  repo.updateStatus(g.id, "planning");
  repo.updateStatus(g.id, "proposed");
  repo.updateStatus(g.id, "approved");
  repo.updateStatus(g.id, "in_progress");
  repo.updateStatus(g.id, "verifying");
  return g.id;
};

const depsWith = (exitCode: number): RunVerificationDeps => ({
  sandboxRootFor: () => process.cwd(),
  callMetricTool: () => Promise.resolve({}),
  runCommand: () => Promise.resolve({ exitCode, stdout: "", stderr: "", timedOut: false }),
});

describe("verification gate", () => {
  let db: Database.Database;
  let companyId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
  });

  it("all-pass moves a verifying goal to achieved", async () => {
    const goalId = toVerifying(db, companyId);
    createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "x", expectedExitCode: 0, timeoutMs: 1000 },
    });
    await runVerification(db, goalId, depsWith(0));
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("achieved");
  });

  it("a goal with no criteria moves straight to achieved", async () => {
    const goalId = toVerifying(db, companyId);
    await runVerification(db, goalId, depsWith(0));
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("achieved");
  });

  it("a failed check bounces the goal to in_progress and files an inbox card", async () => {
    const goalId = toVerifying(db, companyId);
    createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "x", expectedExitCode: 0, timeoutMs: 1000 },
    });
    await runVerification(db, goalId, depsWith(1));
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("in_progress");
    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE company_id = ?")
      .all(companyId) as { kind: string }[];
    expect(inbox.some((i) => i.kind === "verification_failed")).toBe(true);
  });

  it("a pending judgment keeps the goal verifying and files a review card", async () => {
    const goalId = toVerifying(db, companyId);
    createGoalCriteriaRepository(db).create({ goalId, statement: "on brand", kind: "judgment" });
    await runVerification(db, goalId, depsWith(0));
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("verifying");
    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE company_id = ?")
      .all(companyId) as { kind: string }[];
    expect(inbox.some((i) => i.kind === "verification_review")).toBe(true);
  });

  it("applyVerificationReport ignores a goal not in verifying", () => {
    const repo = createGoalsRepository(db);
    const g = repo.create({ companyId, title: "G" });
    applyVerificationReport(db, { goalId: g.id, allPassed: true, results: [], pendingJudgment: [] });
    expect(repo.getById(g.id)?.status).toBe("draft");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test verification/index`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/main/src/verification/index.ts`:

```typescript
// The verification gate (spec §6.4) + production wiring.
// applyVerificationReport transitions a `verifying` goal: all-pass -> achieved;
// any fail -> in_progress + verification_failed inbox; pending judgment ->
// stays verifying + verification_review inbox. runVerification = engine + gate.
// recoverStuckVerifications re-runs goals left in `verifying` after a restart.

import type Database from "better-sqlite3";
import type { Goal, VerificationReport } from "@prospero/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { runGoalVerification } from "./engine.js";
import { runSandboxedCommand } from "./sandbox.js";
import type { RunSandboxedCommandInput, SandboxedCommandResult } from "./sandbox.js";
import type { VerifyContext } from "./checks.js";

export interface RunVerificationDeps {
  // The sandbox cwd for a goal's command checks (goal owner's sandbox).
  sandboxRootFor: (goal: Goal) => string;
  // Invokes a Prospero MCP tool by name for a metric check.
  callMetricTool: (tool: string, params: Record<string, unknown>) => Promise<unknown>;
  // Injected for tests; defaults to the real sandboxed runner.
  runCommand?: (input: RunSandboxedCommandInput) => Promise<SandboxedCommandResult>;
  // Optional UI notification after the gate runs (inbox/goal changed).
  notify?: (companyId: string) => void;
}

// Applies a verification report to a goal that is currently `verifying`.
// A no-op if the goal moved on (defensive against double runs).
export const applyVerificationReport = (
  db: Database.Database,
  report: VerificationReport,
): void => {
  const goalsRepo = createGoalsRepository(db);
  const goal = goalsRepo.getById(report.goalId);
  if (goal === null || goal.status !== "verifying") return;

  const failed = report.results.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    goalsRepo.updateStatus(goal.id, "in_progress");
    createInboxRepository(db).create({
      companyId: goal.companyId,
      kind: "verification_failed",
      title: `Verification failed: ${goal.title}`,
      preview: failed[0]!.detail.slice(0, 200),
      requiresAction: true,
      payloadJson: JSON.stringify({
        goalId: goal.id,
        failedCriteria: failed.map((f) => f.criterionId),
      }),
    });
    return;
  }

  if (report.pendingJudgment.length > 0) {
    createInboxRepository(db).create({
      companyId: goal.companyId,
      kind: "verification_review",
      title: `Review needed: ${goal.title}`,
      preview: `${report.pendingJudgment.length} criteria need your judgment`,
      requiresAction: true,
      payloadJson: JSON.stringify({ goalId: goal.id, pending: report.pendingJudgment }),
    });
    return;
  }

  goalsRepo.updateStatus(goal.id, "achieved");
};

// Runs the engine for one goal and applies the gate. Fire-and-forget safe.
export const runVerification = async (
  db: Database.Database,
  goalId: string,
  deps: RunVerificationDeps,
): Promise<VerificationReport> => {
  const goal = createGoalsRepository(db).getById(goalId);
  if (goal === null) throw new Error(`goal not found: ${goalId}`);
  const ctx: VerifyContext = {
    db,
    sandboxRoot: deps.sandboxRootFor(goal),
    runCommand: deps.runCommand ?? runSandboxedCommand,
    callMetricTool: deps.callMetricTool,
  };
  const report = await runGoalVerification(goalId, ctx);
  applyVerificationReport(db, report);
  deps.notify?.(goal.companyId);
  return report;
};

// Boot recovery: re-run any goal left in `verifying` by a crash/restart.
export const recoverStuckVerifications = (
  db: Database.Database,
  deps: RunVerificationDeps,
): void => {
  const rows = db.prepare("SELECT id FROM goals WHERE status = 'verifying'").all() as {
    id: string;
  }[];
  for (const row of rows) {
    void runVerification(db, row.id, deps).catch(() => {
      /* a stuck goal that fails to re-verify stays verifying — surfaced in UI */
    });
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test verification/index`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/verification/index.ts apps/main/src/verification/index.test.ts
git commit -m "feat(verification): add the verification gate and runner"
```

---

## Task 11: The issue-done verification trigger

**Files:**
- Create: `apps/main/src/verification/trigger.ts`
- Create: `apps/main/tests/verification-trigger.test.ts`
- Modify: `apps/main/src/ipc/issues-handlers.ts`

> Read `apps/main/src/ipc/issues-handlers.ts` — the `ISSUES_UPDATE` handler and the M8.6 topological-unlock block. Confirm the `Issue` shared type exposes `goalId` (the `issues.goal_id` column). Confirm how the handler builds `userDataDir` / broadcasts inbox updates.

- [ ] **Step 1: Write the failing test**

Create `apps/main/tests/verification-trigger.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createGoalsRepository } from "../src/goals/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { maybeStartVerification } from "../src/verification/trigger.js";
import type { RunVerificationDeps } from "../src/verification/index.js";

const deps: RunVerificationDeps = {
  sandboxRootFor: () => process.cwd(),
  callMetricTool: () => Promise.resolve({}),
  runCommand: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
};

describe("maybeStartVerification", () => {
  let db: Database.Database;
  let companyId: string;
  let goalId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    const repo = createGoalsRepository(db);
    const g = repo.create({ companyId, title: "G" });
    repo.updateStatus(g.id, "planning");
    repo.updateStatus(g.id, "proposed");
    repo.updateStatus(g.id, "approved");
    repo.updateStatus(g.id, "in_progress");
    goalId = g.id;
  });

  const linkedIssue = (status: "todo" | "done") => {
    const issue = createIssuesRepository(db).create({ companyId, title: "I" });
    db.prepare("UPDATE issues SET goal_id = ?, status = ? WHERE id = ?").run(
      goalId,
      status,
      issue.id,
    );
    return createIssuesRepository(db).getById(issue.id)!;
  };

  it("transitions the goal to verifying when the last issue is done", () => {
    linkedIssue("done");
    const last = linkedIssue("done");
    maybeStartVerification(db, last, deps);
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("verifying");
  });

  it("does nothing while an issue is still open", () => {
    linkedIssue("todo");
    const done = linkedIssue("done");
    maybeStartVerification(db, done, deps);
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("in_progress");
  });

  it("does nothing for an issue with no goal", () => {
    const issue = createIssuesRepository(db).create({ companyId, title: "free" });
    const done = createIssuesRepository(db).update(
      issue.id,
      { status: "done" },
      { actorKind: "user", actorId: null },
    )!;
    expect(() => maybeStartVerification(db, done, deps)).not.toThrow();
  });
});
```

> Adjust `createIssuesRepository(db).create({...})` / `.update(...)` calls to the real signatures.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test verification-trigger`
Expected: FAIL — `Cannot find module '../src/verification/trigger.js'`.

- [ ] **Step 3: Write the trigger**

Create `apps/main/src/verification/trigger.ts`:

```typescript
// Bridges the issue lifecycle to the verification engine (spec §6.1): when the
// LAST issue of an in_progress goal reaches done/cancelled, the goal moves to
// `verifying` and verification runs (fire-and-forget).

import type Database from "better-sqlite3";
import type { Issue } from "@prospero/shared";
import { createGoalsRepository } from "../goals/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { runVerification } from "./index.js";
import type { RunVerificationDeps } from "./index.js";

export const maybeStartVerification = (
  db: Database.Database,
  issue: Issue,
  deps: RunVerificationDeps,
): void => {
  if (issue.goalId === null) return;
  if (issue.status !== "done" && issue.status !== "cancelled") return;

  const goalsRepo = createGoalsRepository(db);
  const goal = goalsRepo.getById(issue.goalId);
  if (goal === null || goal.status !== "in_progress") return;

  const issues = createIssuesRepository(db).listByGoal(goal.id);
  const allTerminal =
    issues.length > 0 &&
    issues.every((i) => i.status === "done" || i.status === "cancelled");
  if (!allTerminal) return;

  goalsRepo.updateStatus(goal.id, "verifying");
  void runVerification(db, goal.id, deps).catch(() => {
    /* the goal stays `verifying`; boot recovery / a manual re-run handles it */
  });
};
```

> If the `Issue` type's goal field is named differently than `goalId`, use the real name throughout.

- [ ] **Step 4: Wire it into the issue handler**

In `apps/main/src/ipc/issues-handlers.ts`:

1. Add imports:
```typescript
import { maybeStartVerification } from "../verification/trigger.js";
import { buildVerificationDeps } from "../verification/deps.js";
```
2. Inside `registerIssuesHandlers(db)`, build the deps once (near where `db` and other setup live):
```typescript
  const verificationDeps = buildVerificationDeps(db);
```
3. In the `ISSUES_UPDATE` handler, immediately after the M8.6 topological-unlock block (still inside `if (next !== null) { ... }`), add:
```typescript
      maybeStartVerification(db, next, verificationDeps);
```

- [ ] **Step 5: Create the production deps builder**

Create `apps/main/src/verification/deps.ts`:

```typescript
// Production RunVerificationDeps: resolves a goal's sandbox cwd and a metric
// tool caller backed by the in-process Prospero MCP tool registry. External
// MCP servers as metric sources are out of scope for M13 PR-B1.

import { app, BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import { getAgentSandboxCwd } from "../orchestrator/util/paths.js";
import type { RunVerificationDeps } from "./index.js";

export const buildVerificationDeps = (db: Database.Database): RunVerificationDeps => {
  let userDataDir = "";
  try {
    userDataDir = app.getPath("userData");
  } catch {
    /* tests run without an Electron app — sandboxRootFor falls back to cwd */
  }
  return {
    sandboxRootFor: (goal) =>
      goal.ownerAgentId !== null && userDataDir !== ""
        ? getAgentSandboxCwd(userDataDir, goal.ownerAgentId)
        : process.cwd(),
    callMetricTool: (tool) =>
      // B1: metric tools resolve from the Prospero MCP registry. Until a
      // metric-capable tool ships, an unknown tool fails the check cleanly.
      Promise.reject(new Error(`metric tool not available: ${tool}`)),
    notify: (companyId) => {
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.INBOX_UPDATE, { companyId });
        }
      } catch {
        /* no Electron host in tests */
      }
    },
  };
};
```

> **Note on `callMetricTool`:** the spec wants metric checks to invoke an MCP tool. No Prospero MCP tool currently returns a comparable metric, and external MCP servers are out of B1 scope — so B1's production `callMetricTool` rejects with a clear message (→ `checkMetric` turns it into a `failed` result with that detail). The `checkMetric` comparison logic itself is fully implemented and tested (Task 8) via the injected caller. Confirm `IPC.INBOX_UPDATE` is the real channel name (grep `ipc-channels.ts`); if inbox updates use a different channel, use that.

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --filter @prospero/main test verification-trigger`
Expected: PASS — 3 tests.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/verification/trigger.ts apps/main/src/verification/deps.ts apps/main/tests/verification-trigger.test.ts apps/main/src/ipc/issues-handlers.ts
git commit -m "feat(verification): trigger verification when a goal's issues finish"
```

---

## Task 12: Plan schema + executor — populate issue_criteria

**Files:**
- Modify: `apps/main/src/schemas/goalPlan.ts`
- Modify: `apps/main/src/goals/executor.ts`
- Modify: `apps/main/src/mcp/tools-goals.ts`
- Modify: an executor test (`apps/main/src/goals/executor.test.ts` — confirm it exists)

> Read `apps/main/src/schemas/goalPlan.ts` (the `IssueToCreateSchema`), `apps/main/src/goals/executor.ts` (the atomic issue-creation loop), and `apps/main/src/mcp/tools-goals.ts` (`createIssueForPlan`, the narrated path).

- [ ] **Step 1: Add `advancesCriteria` to the plan schema**

In `apps/main/src/schemas/goalPlan.ts`, add to `IssueToCreateSchema` (after `dependsOnIndexes`):

```typescript
  advancesCriteria: z.array(z.string().min(1).max(120)).max(50).optional(),
```

(Optional — existing stored plans predate the field. Matches the optional `IssueToCreate.advancesCriteria` shared type from Task 1.)

- [ ] **Step 2: Write the failing test**

In the executor test file, add a test that approves+executes a plan whose issue carries `advancesCriteria` and asserts an `issue_criteria` row was created. Adapt to the file's existing plan-execution test helpers:

```typescript
  it("links issue_criteria for an issue's advancesCriteria", () => {
    // 1. seed a company, a goal in `planning`, and a goal_criterion.
    // 2. submit a plan whose single issue has advancesCriteria: [criterionId].
    // 3. approve + execute the plan (atomic path).
    // 4. assert: SELECT COUNT(*) FROM issue_criteria WHERE criterion_id = ? === 1
    const critId = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
    }).id;
    // ...submit a plan with one issue { ..., advancesCriteria: [critId] }, approve, execute...
    const linked = db
      .prepare("SELECT COUNT(*) AS n FROM issue_criteria WHERE criterion_id = ?")
      .get(critId) as { n: number };
    expect(linked.n).toBe(1);
  });
```

> The exact plan-submit/approve/execute calls must mirror an existing executor test in the same file — copy that test's setup and just add `advancesCriteria: [critId]` to the issue spec.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test executor`
Expected: FAIL — no `issue_criteria` row created.

- [ ] **Step 4: Populate `issue_criteria` in the atomic executor**

In `apps/main/src/goals/executor.ts`, in the issue-creation loop, immediately after the issue is linked to the goal (after `linkIssueGoalStmt.run(goal.id, created.id)` or equivalent), add:

```typescript
        // M13: link the ISCs this issue advances. Skip ids that don't belong to
        // this goal (a stale criterion id must not abort plan execution).
        for (const criterionId of issue.advancesCriteria ?? []) {
          const criterion = criteriaRepo.getById(criterionId);
          if (criterion !== null && criterion.goalId === goal.id) {
            issueCriteriaRepo.link(created.id, criterionId);
          }
        }
```

Add the two repos near the top of the executor function (where `issuesRepo` is created):

```typescript
  const criteriaRepo = createGoalCriteriaRepository(db);
  const issueCriteriaRepo = createIssueCriteriaRepository(db);
```

Add the imports:
```typescript
import { createGoalCriteriaRepository } from "./criteria-repository.js";
import { createIssueCriteriaRepository } from "./issue-criteria-repository.js";
```

- [ ] **Step 5: Populate `issue_criteria` in the narrated path**

In `apps/main/src/mcp/tools-goals.ts`, in the `create_issue_for_plan` tool's `run`, after the issue is created and linked to the goal (`UPDATE issues SET goal_id = ...`), add the same linking loop. The narrated path gets the issue spec from the stored plan (`plan.issuesToCreate[planIndex]`), so:

```typescript
    for (const criterionId of issueSpec.advancesCriteria ?? []) {
      const criterion = createGoalCriteriaRepository(ctx.db).getById(criterionId);
      if (criterion !== null && criterion.goalId === goal.id) {
        createIssueCriteriaRepository(ctx.db).link(created.id, criterionId);
      }
    }
```

Add the imports to `tools-goals.ts` if not present:
```typescript
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createIssueCriteriaRepository } from "../goals/issue-criteria-repository.js";
```

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --filter @prospero/main test executor`
Expected: PASS.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/schemas/goalPlan.ts apps/main/src/goals/executor.ts apps/main/src/mcp/tools-goals.ts apps/main/src/goals
git commit -m "feat(verification): link issue_criteria from approved plans"
```

---

## Task 13: Judgment-resolution IPC + boot recovery

**Files:**
- Modify: `apps/main/src/verification/index.ts` (add `reevaluateGoalFromState`; add a `fileReviewCard` option to `applyVerificationReport`)
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `apps/main/src/ipc/isa-handlers.ts`
- Modify: `apps/main/tests/isa-handlers.test.ts`
- Modify: `apps/main/src/ipc/handlers.ts` (boot recovery)
- Modify: `apps/main/src/ipc/preload.ts` + the `window.prospero` type

> Read the current `apps/main/src/ipc/handlers.ts` (`registerIpcHandlers` — where `initDerivation(db)` is called).

- [ ] **Step 1: Add `fileReviewCard` option + `reevaluateGoalFromState` to `verification/index.ts`**

In `apps/main/src/verification/index.ts`:

1. Change `applyVerificationReport`'s signature to accept an options object and gate the review-card creation on it:

```typescript
export const applyVerificationReport = (
  db: Database.Database,
  report: VerificationReport,
  opts: { fileReviewCard?: boolean } = {},
): void => {
```

Inside the `pendingJudgment` branch, wrap the `createInboxRepository(db).create({ ... kind: "verification_review" ... })` call so it only runs when `opts.fileReviewCard !== false`:

```typescript
  if (report.pendingJudgment.length > 0) {
    if (opts.fileReviewCard !== false) {
      createInboxRepository(db).create({
        companyId: goal.companyId,
        kind: "verification_review",
        title: `Review needed: ${goal.title}`,
        preview: `${report.pendingJudgment.length} criteria need your judgment`,
        requiresAction: true,
        payloadJson: JSON.stringify({ goalId: goal.id, pending: report.pendingJudgment }),
      });
    }
    return;
  }
```

(`runVerification` already calls `applyVerificationReport(db, report)` with no opts — that keeps `fileReviewCard` defaulting to `true`, unchanged behavior.)

2. Add `reevaluateGoalFromState` — a checks-free re-evaluation used after a user resolves a judgment criterion (it must NOT re-run `pnpm test`):

```typescript
// Re-evaluates a `verifying` goal from the criteria's already-persisted
// statuses (no checks are re-run) and applies the gate. Used after a user
// resolves a judgment criterion. Does not re-file the review inbox card.
export const reevaluateGoalFromState = (db: Database.Database, goalId: string): void => {
  const goal = createGoalsRepository(db).getById(goalId);
  if (goal === null || goal.status !== "verifying") return;
  const criteria = createGoalCriteriaRepository(db).listByGoal(goalId);
  const results = criteria.map((c) => ({
    criterionId: c.id,
    status: c.status,
    detail: `${c.kind}: ${c.status}`,
    resultJson: null,
  }));
  const pendingJudgment = results
    .filter((r) => r.status === "pending")
    .map((r) => r.criterionId);
  const allPassed = results.every((r) => r.status === "passed" || r.status === "waived");
  applyVerificationReport(
    db,
    { goalId, allPassed, results, pendingJudgment },
    { fileReviewCard: false },
  );
};
```

Add the `createGoalCriteriaRepository` import to `verification/index.ts`.

- [ ] **Step 2: Add the IPC channel**

In `packages/shared/src/ipc-channels.ts`, add next to the other `ISA_*` channels:

```typescript
  ISA_CRITERION_JUDGE: "isa:criterion-judge",
```

- [ ] **Step 3: Write the failing test**

In `apps/main/tests/isa-handlers.test.ts`, add a test. The handler factory `isaHandlers(deps)` will gain a `criterionJudge` method:

```typescript
  it("criterionJudge resolves a judgment criterion and re-evaluates the goal", () => {
    const { db, h, goalId } = setup();
    // move the goal to `verifying`
    const goalsRepo = createGoalsRepository(db);
    for (const s of ["planning", "proposed", "approved", "in_progress", "verifying"] as const) {
      goalsRepo.updateStatus(goalId, s);
    }
    const criteriaRepo = createGoalCriteriaRepository(db);
    const c = criteriaRepo.create({ goalId, statement: "on brand", kind: "judgment" });
    h.criterionJudge({ criterionId: c.id, verdict: "passed" });
    expect(criteriaRepo.getById(c.id)?.status).toBe("passed");
    // the only criterion is now passed -> the goal is achieved
    expect(goalsRepo.getById(goalId)?.status).toBe("achieved");
  });

  it("criterionJudge throws for an unknown criterion", () => {
    const { h } = setup();
    expect(() => h.criterionJudge({ criterionId: "nope", verdict: "passed" })).toThrow(
      /not found/,
    );
  });
```

> Add the `createGoalsRepository` / `createGoalCriteriaRepository` imports to the test file if missing.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test isa-handlers`
Expected: FAIL — `h.criterionJudge is not a function`.

- [ ] **Step 5: Add the `criterionJudge` handler**

In `apps/main/src/ipc/isa-handlers.ts`:

1. Add imports:
```typescript
import type { CriterionStatus } from "@prospero/shared";
import { reevaluateGoalFromState } from "../verification/index.js";
```
2. Add `criterionJudge` to the `IsaHandlers` type:
```typescript
  criterionJudge(args: { criterionId: string; verdict: CriterionStatus }): void;
```
3. Add the implementation to the object returned by `isaHandlers`:
```typescript
    criterionJudge({ criterionId, verdict }) {
      const criterion = criteriaRepo.getById(criterionId);
      if (criterion === null) throw new Error(`criterion not found: ${criterionId}`);
      criteriaRepo.setJudgment(criterionId, verdict, null);
      reevaluateGoalFromState(deps.db, criterion.goalId);
    },
```
4. Register it in `registerIsaHandlers`:
```typescript
  ipcMain.handle(
    IPC.ISA_CRITERION_JUDGE,
    (_e, args: { criterionId: string; verdict: CriterionStatus }) => h.criterionJudge(args),
  );
```

- [ ] **Step 6: Wire boot recovery**

In `apps/main/src/ipc/handlers.ts`, add imports and a call to recover goals stuck in `verifying`, placed right after `initDerivation(db)` (or wherever one-time DB-dependent init runs):

```typescript
import { recoverStuckVerifications } from "../verification/index.js";
import { buildVerificationDeps } from "../verification/deps.js";
```
```typescript
  recoverStuckVerifications(db, buildVerificationDeps(db));
```

- [ ] **Step 7: Expose `criterionJudge` on the preload bridge + window type**

In `apps/main/src/ipc/preload.ts`, add to the `isa` namespace:
```typescript
    criterionJudge: (args: { criterionId: string; verdict: CriterionStatus }) =>
      ipcRenderer.invoke(IPC.ISA_CRITERION_JUDGE, args) as Promise<void>,
```
Add `CriterionStatus` to the `@prospero/shared` type import in `preload.ts`.

In the `window.prospero` type declaration (`apps/renderer/src/env.d.ts` — confirm), add to the `isa` field, in the file's arrow-property style:
```typescript
    criterionJudge: (args: { criterionId: string; verdict: CriterionStatus }) => Promise<void>;
```
Add `CriterionStatus` to that file's `@prospero/shared` import.

- [ ] **Step 8: Run test + typecheck**

Run: `pnpm --filter @prospero/main test isa-handlers`
Expected: PASS.
Run: `pnpm --filter @prospero/main typecheck && pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/verification/index.ts apps/main/src/ipc/isa-handlers.ts apps/main/tests/isa-handlers.test.ts apps/main/src/ipc/handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(verification): add judgment-resolution ipc and boot recovery"
```

---

## Task 14: Renderer — criterion status, judge button, verifying badge

**Files:**
- Modify: `apps/renderer/src/stores/isa.ts`
- Modify: `apps/renderer/src/components/IsaPanel.tsx`
- Modify: `apps/renderer/src/routes/GoalDetail.tsx` (or the goal-detail header component)

> No test file (renderer has no component-test harness). Verification is typecheck + lint. Use only real Tailwind tokens (`semantic-success`, `semantic-danger`, `semantic-warning`, `ink-soft`, `ink-muted`, `surface-*`, `brand`, `brand-fg`) — confirm against `apps/renderer/tailwind.config.ts`.

- [ ] **Step 1: Add `judgeCriterion` to the store**

In `apps/renderer/src/stores/isa.ts`:

1. Import `CriterionStatus`:
```typescript
import type { /* existing... */ CriterionStatus } from "@prospero/shared";
```
2. Add to the store `State` type:
```typescript
  judgeCriterion: (id: string, verdict: CriterionStatus) => Promise<void>;
```
3. Add the action (mirror `removeCriterion`'s shape — try/catch, reload after):
```typescript
  judgeCriterion: async (id, verdict) => {
    const { goalId } = get();
    try {
      await window.prospero.isa.criterionJudge({ criterionId: id, verdict });
      if (goalId !== null) await get().load(goalId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
```

- [ ] **Step 2: Show criterion status + a judge affordance in `IsaPanel`**

In `apps/renderer/src/components/IsaPanel.tsx`, in the `IsaCriteriaList` criterion `<li>`:

1. Replace the fixed neutral status dot with a status-colored dot. Add a helper above the component:
```tsx
const STATUS_DOT: Record<CriterionStatus, string> = {
  pending: "bg-ink-soft",
  passed: "bg-semantic-success",
  failed: "bg-semantic-danger",
  waived: "bg-ink-muted",
};
```
and render `<span className={\`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[c.status]}\`} aria-hidden />`. Import `CriterionStatus` from `@prospero/shared`.

2. After the kind badge, when `c.kind === "judgment" && c.status === "pending"`, render two small buttons:
```tsx
{c.kind === "judgment" && c.status === "pending" && (
  <span className="flex gap-1">
    <button
      type="button"
      className="px-2 py-0.5 text-[10px] rounded border border-surface-border text-semantic-success"
      onClick={() => void store.judgeCriterion(c.id, "passed")}
    >
      {t("isa.judgePass")}
    </button>
    <button
      type="button"
      className="px-2 py-0.5 text-[10px] rounded border border-surface-border text-semantic-danger"
      onClick={() => void store.judgeCriterion(c.id, "failed")}
    >
      {t("isa.judgeFail")}
    </button>
  </span>
)}
```

3. Optionally show `t(\`isa.status.${c.status}\`)` as a tiny label next to the dot. Keep it minimal.

- [ ] **Step 3: Render the `verifying` goal status**

Adding `"verifying"` to `GoalStatus` (Task 1) will surface a typecheck error wherever a `Record<GoalStatus, ...>` is used exhaustively for status labels/colors — likely in the goal-detail header or a goal status-badge helper. Find it (typecheck will point at it) and add a `verifying` entry: a label key `t("goals.status.verifying")` and a color (use `semantic-warning` / `semantic-warning-bg` or the existing in-progress styling). Make the goal-detail status badge render `verifying` correctly.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean (the i18n keys are added in Task 16 — typecheck does not depend on them).
Run: `pnpm --filter @prospero/renderer lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/stores/isa.ts apps/renderer/src/components/IsaPanel.tsx apps/renderer/src/routes/GoalDetail.tsx
git commit -m "feat(verification): show criterion status and judgment controls"
```

---

## Task 15: Inbox cards for the verification kinds

**Files:**
- Modify: `apps/renderer/src/routes/Inbox.tsx`

> Read `apps/renderer/src/routes/Inbox.tsx` — the `KIND_BORDER` map (a `Record<InboxKind, string>`) and the per-kind conditional render blocks.

- [ ] **Step 1: Add the two kinds to `KIND_BORDER`**

Adding the 2 kinds to `InboxKind` (Task 1) will surface a typecheck error on the `Record<InboxKind, string>` `KIND_BORDER` map. Add the entries:

```typescript
  verification_failed: "border-l-4 border-l-semantic-danger",
  verification_review: "border-l-4 border-l-semantic-warning",
```

(Match the real left-border class style the sibling kinds use.)

- [ ] **Step 2: Add render handling for the two kinds**

In the per-kind render section, the existing cards render a title + preview + (for `requiresAction` kinds) navigation. For B1, a minimal card is enough: title + preview + a link/button to open the goal (the `payloadJson` carries `{ goalId }`). If the file has a generic fallback card that renders title+preview for any kind, the 2 new kinds are already covered — confirm. If each kind needs an explicit block, add two blocks mirroring the closest sibling (e.g. `goal_error`): parse `payloadJson` for `goalId`, render the title/preview, and a button that navigates to `/goals/<goalId>` (use the file's existing navigation helper). Use `t("inbox.verificationFailed.*")` / `t("inbox.verificationReview.*")` keys (added in Task 16) for any static label text; do not hardcode strings.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/renderer lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/routes/Inbox.tsx
git commit -m "feat(verification): add inbox cards for verification outcomes"
```

---

## Task 16: i18n keys

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

> Cross-check the exact keys referenced by `IsaPanel.tsx`, `GoalDetail.tsx`/the status helper, and `Inbox.tsx` after Tasks 14-15. Add exactly those; the EN and PT key sets must be identical.

- [ ] **Step 1: Add the English keys**

In `apps/renderer/src/i18n/en-US.json`, extend the existing `"isa"` object with the judgment + status keys, add the `verifying` goal status label, and add the inbox keys. Use these (adjust paths if the goal-status labels live elsewhere — match where `goals.status.in_progress` etc. live):

Into `isa`:
```json
"judgePass": "Pass",
"judgeFail": "Fail",
"status": {
  "pending": "Pending",
  "passed": "Passed",
  "failed": "Failed",
  "waived": "Waived"
}
```
Into `goals.status` (next to `in_progress`):
```json
"verifying": "Verifying"
```
A new section (or into the existing `inbox` object):
```json
"inbox": {
  "verificationFailed": { "open": "Open goal" },
  "verificationReview": { "open": "Review goal" }
}
```

- [ ] **Step 2: Add the Portuguese keys**

In `apps/renderer/src/i18n/pt-BR.json`, mirror with the same key paths:

Into `isa`:
```json
"judgePass": "Aprovar",
"judgeFail": "Reprovar",
"status": {
  "pending": "Pendente",
  "passed": "Aprovado",
  "failed": "Reprovado",
  "waived": "Dispensado"
}
```
Into `goals.status`:
```json
"verifying": "Verificando"
```
Inbox:
```json
"inbox": {
  "verificationFailed": { "open": "Abrir objetivo" },
  "verificationReview": { "open": "Revisar objetivo" }
}
```

> If `goals.status` / `inbox` objects already exist, merge into them — do not create duplicates. The two locale files' key sets must end up identical.

- [ ] **Step 3: Run the parity test**

Run: `pnpm --filter @prospero/renderer test parity`
Expected: PASS — identical EN/PT key sets. If it fails, diff the added blocks and reconcile.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(verification): add i18n keys for verification ui"
```

---

## Task 17: Full verification + non-regression

**Files:** none (verification only).

- [ ] **Step 1: Update any tool/channel count assertion test**

M13 PR-B1 adds 1 IPC channel (`ISA_CRITERION_JUDGE`) and no MCP tools. Search the test suites for an exact-count assertion on IPC channels (grep `*.test.ts` near `ipc-channels`); if one exists and now fails, bump the expected number. If none exists, note it and move on.

- [ ] **Step 2: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: clean across `@prospero/shared`, `@prospero/main`, `@prospero/renderer`, `@prospero/agent-runner`.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: every package green (the 2 pre-existing `todo` tests in `apps/main` are fine). Confirm the new verification tests all pass.

- [ ] **Step 5: Manual smoke (record results, do not skip silently)**

Build/run the app and verify:
1. Create a goal, give it an ISA criterion (deterministic `command`, e.g. `node -e "process.exit(0)"`), plan + execute it so it has issues, move all issues to `done`.
2. The goal flips to **Verifying**, then — the command exits 0 — to **Achieved**.
3. Make a criterion fail (a `command` that exits non-zero); finishing the issues bounces the goal to **In progress** and an inbox `verification_failed` card appears.
4. A judgment criterion: finishing the issues leaves the goal **Verifying** with a `verification_review` inbox card; clicking **Pass** in the ISA panel moves the goal to **Achieved**.
5. A goal with **no** criteria still reaches **Achieved** when its issues finish (non-regression).

Record what passed and what didn't. Note: command checks spawn real processes — if the environment can't run them, say so explicitly rather than claiming success.

- [ ] **Step 6: Final commit (only if Step 1 required edits)**

```bash
git add -A
git commit -m "test(verification): update channel count assertion"
```

---

## Self-Review (completed by plan author)

**Spec coverage (spec §15 row B + §5.3, §6):**
- M13-02 `issue_criteria` migration → Task 2. ✓
- Join populated by the plan executor → Task 12 (atomic + narrated). ✓
- `apps/main/src/verification/` module (`runGoalVerification`, `checkCommand`/`checkMetric`/`checkArtifact`) → Tasks 8-10. ✓
- `runSandboxedCommand` → Task 7. ✓
- `verifying` status + the `achieved` gate → Tasks 1, 3, 10. ✓
- Inbox `verification_failed` / `verification_review` (M13-03 migration) → Tasks 2, 10. ✓
- Live ISC checklist in the UI → Task 14 (status dots + verifying badge). ✓
- §6.1 trigger (last issue done → verifying) → Task 11. ✓
- §6.5 non-regression (goal with 0 ISCs verifies trivially) → Task 9 + Task 10 test + Task 17 smoke. ✓
- §17 security: command cwd fixed by the caller, never the ISC (Task 7/8); `minimalVerificationEnv` no secrets (Task 7); judgment resolution is human-authored (Task 13). ✓

**Deferred to B2 (correctly out of scope):** `criterion_check` / `criterion_judge` MCP tools (agent-facing); GoalPlanReview ISC-coverage display; the §17.3 first-run command confirmation prompt (B1 runs human-authored ISC commands directly — flagged as a B2 hardening item); LEARN/derivation payload enrichment (PR-D); `metric` checks against external MCP servers.

**Type consistency:** `CriterionResult` / `VerificationReport` defined once (Task 1), used in Tasks 8-13. `VerifyContext` defined in Task 8, used in 9-10. `RunVerificationDeps` defined in Task 10, used in 11. `runVerification` / `applyVerificationReport` / `reevaluateGoalFromState` / `recoverStuckVerifications` names consistent across Tasks 10-13.

**Open items the executor must confirm against the codebase** (flagged inline): the exact `inbox_items` column/kind list to reproduce in migration `0028`; whether the `Issue` type field is `goalId`; the issues-repo and executor test file locations and their `create(...)` input shapes; the `window.prospero` type-declaration file; where `Record<GoalStatus,...>` / `Record<InboxKind,...>` exhaustive maps live; the real `IPC.INBOX_UPDATE` channel name; whether `Inbox.tsx` has a generic fallback card.

**B1 known limitation (documented, not a gap):** `runVerification` is fire-and-forget; if the app is killed mid-verification the goal sits in `verifying` until the next launch, when `recoverStuckVerifications` re-runs it. Command checks are re-run on recovery (idempotent for typical test/build commands).
