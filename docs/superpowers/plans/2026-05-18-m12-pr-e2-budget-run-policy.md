# M12 PR-E2 — Per-Agent Budget + Run Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-agent token/USD budget that extends the M8 soft-stop, plus a Run Policy (`can_hire`/`can_assign`) that filters the agent's `--allowedTools`.

**Architecture:** Six new columns on `agents` (migration `0026`). Budget enforcement extends `checkAndPause` after the existing global checks — 80% raises a new `budget_warning` Inbox item (deduped per period), 100% pauses with a new `budget_exceeded_agent` pause reason. Run Policy subtracts hire/fire/assign tools from the resolved capability tool list at spawn time. Runs derive from `cost_events` (already done in PR-E1); this PR adds no new tables beyond columns.

**Tech Stack:** Electron + TypeScript, better-sqlite3, React renderer, vitest. Spec: `docs/superpowers/specs/2026-05-18-m12-pr-e-runs-budget-policy-design.md` §2–4, §8.

**Scope note — trims vs. the spec:** `CreateAgentInput` is **not** extended (spec §4.2 suggested it). New agents get the column DB-defaults (`budget_period='daily'`, `can_hire=can_assign=1`, limits NULL); budget/policy are set post-creation via the new IPCs. No caller (UI hire, AGENTS.md import, org plans) carries budget data, so threading it through the `INSERT` is YAGNI. `setBudget`/`setPermissions` do **not** record activity events (`ActivityAction` is a closed union; extending it is out of scope and the spec does not require it).

---

## File Structure

**Created:**
- `apps/main/src/db/migrations/0026_m12_agent_budget_policy.sql` — 6 columns + `inbox_items` recreate.
- `apps/main/src/costs/period.ts` — `periodKey` + `utcMonthBounds` pure helpers.
- `apps/main/src/costs/period.test.ts` — tests for the above.
- `apps/renderer/src/components/agent-panel/BudgetSection.tsx` — Budget UI for the Stats tab.

**Modified:**
- `packages/shared/src/types/agent.ts` — `Agent` + 5 fields, new `BudgetPeriod`.
- `packages/shared/src/types/inbox.ts` — `budget_warning` kind.
- `packages/shared/src/types/costs.ts` — new `AgentBudgetStatus`.
- `packages/shared/src/capabilities.ts` — new `applyRunPolicy`.
- `packages/shared/src/ipc-channels.ts` — 3 new channels.
- `apps/main/src/agents/repository.ts` — `Row`/`rowToAgent` + `AgentBudgetState` + 4 new methods.
- `apps/main/src/costs/repository.ts` — `getAgentPeriodTotal`.
- `apps/main/src/costs/enforce-budget.ts` — per-agent enforcement.
- `apps/main/src/ipc/orchestrator-handlers.ts` — `enforceDeps` wiring + 2 new handlers.
- `apps/main/src/ipc/costs-handlers.ts` — `costs:get-agent-budget-status` handler.
- `apps/main/src/ipc/preload.ts` — 3 new bridge methods.
- `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts` — apply Run Policy filter.
- `apps/renderer/src/env.d.ts` — typings for the 3 new bridge methods.
- `apps/renderer/src/routes/Inbox.tsx` — `KIND_BORDER` entry.
- `apps/renderer/src/stores/agents.ts` — `setBudget` + `setPermissions` store actions.
- `apps/renderer/src/components/agent-panel/ConfigTab.tsx` — Run Policy section.
- `apps/renderer/src/components/agent-panel/StatsTab.tsx` — mount `BudgetSection`.
- `apps/renderer/src/i18n/en-US.json`, `pt-BR.json` — new keys.
- `ROADMAP.md` — mark PR-E2 done.
- Various test files with `Agent` literals / `CostsRepository` mocks (compiler-flagged).

---

## Task 1: Migration 0026 + shared type changes (lands typecheck-clean)

This task makes the schema + type changes land together so the workspace stays typecheck-clean. Extending `Agent` forces `rowToAgent` (returns `Agent`) and every `Agent` literal to be updated in the same task.

**Files:**
- Create: `apps/main/src/db/migrations/0026_m12_agent_budget_policy.sql`
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/types/inbox.ts`
- Modify: `apps/main/src/agents/repository.ts` (`Row` type + `rowToAgent` only)
- Modify: `apps/renderer/src/routes/Inbox.tsx` (`KIND_BORDER`)

- [ ] **Step 1: Write the migration**

Create `apps/main/src/db/migrations/0026_m12_agent_budget_policy.sql`:

```sql
-- 0026_m12_agent_budget_policy.sql — M12 PR-E2: per-agent Budget + Run Policy.
-- 6 new columns on `agents`:
--   budget_tokens_limit / budget_usd_limit — per-agent caps (NULL = unset);
--     budget_usd_limit is in cents (consistent with cost_cents_estimate).
--   budget_period        — 'daily' | 'monthly' rollover window.
--   budget_warned_period — dedup key for the 80% Inbox warning (internal).
--   can_hire / can_assign — Run Policy sub-toggles of delegation/issues.
-- inbox_items is recreated to add the `budget_warning` kind — SQLite cannot
-- ALTER a CHECK constraint (same recreate pattern as migrations 0019-0025).

ALTER TABLE agents ADD COLUMN budget_tokens_limit INTEGER;
ALTER TABLE agents ADD COLUMN budget_usd_limit INTEGER;
ALTER TABLE agents ADD COLUMN budget_period TEXT NOT NULL DEFAULT 'daily'
  CHECK (budget_period IN ('daily','monthly'));
ALTER TABLE agents ADD COLUMN budget_warned_period TEXT;
ALTER TABLE agents ADD COLUMN can_hire INTEGER NOT NULL DEFAULT 1
  CHECK (can_hire IN (0,1));
ALTER TABLE agents ADD COLUMN can_assign INTEGER NOT NULL DEFAULT 1
  CHECK (can_assign IN (0,1));

PRAGMA defer_foreign_keys = 1;

CREATE TABLE inbox_items_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'approval',
      'completed',
      'suggestion',
      'error',
      'security_alert',
      'goal_proposed',
      'goal_executing',
      'goal_error',
      'agent_unresponsive',
      'skill_candidate_pending',
      'skill_promotion_requested',
      'goal_retrospective_ready',
      'memory_review_needed',
      'org_proposed',
      'budget_warning'
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

- [ ] **Step 2: Extend the `Agent` type + add `BudgetPeriod`**

In `packages/shared/src/types/agent.ts`, add `BudgetPeriod` near the top (next to `AgentMode`):

```ts
export type BudgetPeriod = "daily" | "monthly";
```

Then add five fields to the end of the `Agent` type (after `pauseReason`):

```ts
  budgetTokensLimit: number | null;
  budgetUsdLimit: number | null; // cents
  budgetPeriod: BudgetPeriod;
  canHire: boolean;
  canAssign: boolean;
```

- [ ] **Step 3: Add the `budget_warning` inbox kind**

In `packages/shared/src/types/inbox.ts`, add to the `InboxKind` union (after `"org_proposed"`):

```ts
  | "budget_warning";
```

- [ ] **Step 4: Map the new columns in `rowToAgent`**

In `apps/main/src/agents/repository.ts`:

Add `BudgetPeriod` to the existing `@prospero/shared` type import.

Extend the `Row` type with six new fields (after `pause_reason`):

```ts
  budget_tokens_limit: number | null;
  budget_usd_limit: number | null;
  budget_period: string;
  budget_warned_period: string | null;
  can_hire: number;
  can_assign: number;
```

Extend `rowToAgent` with five mapped fields (after `pauseReason: r.pause_reason,`). `budget_warned_period` is intentionally **not** mapped — it is internal enforcement bookkeeping, not part of the public `Agent` type:

```ts
  budgetTokensLimit: r.budget_tokens_limit,
  budgetUsdLimit: r.budget_usd_limit,
  budgetPeriod: r.budget_period as BudgetPeriod,
  canHire: r.can_hire === 1,
  canAssign: r.can_assign === 1,
```

- [ ] **Step 5: Add the `KIND_BORDER` entry**

In `apps/renderer/src/routes/Inbox.tsx`, add to the `KIND_BORDER` record (after `org_proposed`):

```ts
  budget_warning: "border-l-4 border-l-semantic-warning",
```

- [ ] **Step 6: Typecheck and fix every `Agent` literal**

Run: `pnpm -r typecheck`
Expected: TS2741 errors at every file that builds an `Agent` object literal (test fixtures such as `apps/main/tests/orchestrator.build-args.test.ts`, `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/test-fixtures.ts`, and others the compiler flags).

For each flagged literal, add these five fields:

```ts
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
```

Re-run `pnpm -r typecheck` until clean.

- [ ] **Step 7: Run the full suites**

Run: `pnpm -r test`
Expected: PASS. The migration applies on every in-memory test DB; a malformed migration would fail the whole main suite. If a test asserts a migration count or `user_version`, update it to expect `26`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(budget): add migration 0026 and per-agent budget/policy fields"
```

---

## Task 2: AgentsRepository — budget/policy methods

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Test: `apps/main/src/agents/repository.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/main/src/agents/repository.test.ts` (uses the existing `setupDb` and `baseInput` helpers in that file):

```ts
describe("budget + run policy", () => {
  it("new agents default to daily period, can_hire/can_assign true, null limits", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(a.budgetTokensLimit).toBeNull();
    expect(a.budgetUsdLimit).toBeNull();
    expect(a.budgetPeriod).toBe("daily");
    expect(a.canHire).toBe(true);
    expect(a.canAssign).toBe(true);
  });

  it("setBudget round-trips limits and period", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setBudget(a.id, { tokensLimit: 50_000, usdLimit: 1_200, period: "monthly" });
    const updated = repo.getById(a.id);
    expect(updated?.budgetTokensLimit).toBe(50_000);
    expect(updated?.budgetUsdLimit).toBe(1_200);
    expect(updated?.budgetPeriod).toBe("monthly");
  });

  it("setBudget accepts null limits (unset)", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setBudget(a.id, { tokensLimit: 10, usdLimit: 10, period: "daily" });
    repo.setBudget(a.id, { tokensLimit: null, usdLimit: null, period: "daily" });
    const updated = repo.getById(a.id);
    expect(updated?.budgetTokensLimit).toBeNull();
    expect(updated?.budgetUsdLimit).toBeNull();
  });

  it("setBudget rejects a non-positive token limit", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(() => repo.setBudget(a.id, { tokensLimit: 0, usdLimit: null, period: "daily" })).toThrow(
      /positive integer/i,
    );
  });

  it("setPermissions round-trips can_hire/can_assign", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setPermissions(a.id, { canHire: false, canAssign: false });
    const updated = repo.getById(a.id);
    expect(updated?.canHire).toBe(false);
    expect(updated?.canAssign).toBe(false);
  });

  it("getBudgetState reflects setBudget and starts with a null warnedPeriod", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setBudget(a.id, { tokensLimit: 999, usdLimit: null, period: "monthly" });
    const state = repo.getBudgetState(a.id);
    expect(state).toEqual({
      tokensLimit: 999,
      usdLimit: null,
      period: "monthly",
      warnedPeriod: null,
      adapterName: "claude-oauth-local",
    });
  });

  it("setBudgetWarnedPeriod records the key; setBudget clears it", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setBudget(a.id, { tokensLimit: 999, usdLimit: null, period: "daily" });
    repo.setBudgetWarnedPeriod(a.id, "2026-05-18");
    expect(repo.getBudgetState(a.id)?.warnedPeriod).toBe("2026-05-18");
    repo.setBudget(a.id, { tokensLimit: 500, usdLimit: null, period: "daily" });
    expect(repo.getBudgetState(a.id)?.warnedPeriod).toBeNull();
  });

  it("getBudgetState returns null for an unknown agent", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    expect(repo.getBudgetState("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @prospero/main test -- repository.test.ts`
Expected: FAIL — `setBudget`/`setPermissions`/`getBudgetState`/`setBudgetWarnedPeriod` not on the repository.

- [ ] **Step 3: Implement the new methods**

In `apps/main/src/agents/repository.ts`:

Add the exported `AgentBudgetState` type near the top (after the `Row` type):

```ts
// Internal enforcement view of an agent's budget — includes budget_warned_period,
// which is NOT part of the public Agent type.
export type AgentBudgetState = {
  tokensLimit: number | null;
  usdLimit: number | null;
  period: BudgetPeriod;
  warnedPeriod: string | null;
  adapterName: string;
};
```

Add four method signatures to the `AgentsRepository` type (after `setCapabilities`):

```ts
  setBudget(
    id: string,
    input: { tokensLimit: number | null; usdLimit: number | null; period: BudgetPeriod },
  ): void;
  setBudgetWarnedPeriod(id: string, periodKey: string): void;
  setPermissions(id: string, input: { canHire: boolean; canAssign: boolean }): void;
  getBudgetState(id: string): AgentBudgetState | null;
```

Add the four implementations to the returned object (alongside `setCapabilities`). The `byId` prepared statement (used by `setMode`/`setCapabilities`) selects all columns, so it carries the new ones after migration 0026:

```ts
  setBudget(id, { tokensLimit, usdLimit, period }) {
    const row = byId.get(id) as Row | undefined;
    if (row === undefined) return;
    if (tokensLimit !== null && !(Number.isInteger(tokensLimit) && tokensLimit > 0)) {
      throw new Error("budget_tokens_limit must be a positive integer or null");
    }
    if (usdLimit !== null && !(Number.isInteger(usdLimit) && usdLimit > 0)) {
      throw new Error("budget_usd_limit must be a positive integer or null");
    }
    db.prepare(
      "UPDATE agents SET budget_tokens_limit = ?, budget_usd_limit = ?, budget_period = ?, budget_warned_period = NULL, updated_at = ? WHERE id = ?",
    ).run(tokensLimit, usdLimit, period, Date.now(), id);
  },
  setBudgetWarnedPeriod(id, periodKey) {
    db.prepare("UPDATE agents SET budget_warned_period = ? WHERE id = ?").run(periodKey, id);
  },
  setPermissions(id, { canHire, canAssign }) {
    const row = byId.get(id) as Row | undefined;
    if (row === undefined) return;
    db.prepare(
      "UPDATE agents SET can_hire = ?, can_assign = ?, updated_at = ? WHERE id = ?",
    ).run(canHire ? 1 : 0, canAssign ? 1 : 0, Date.now(), id);
  },
  getBudgetState(id) {
    const row = byId.get(id) as Row | undefined;
    if (row === undefined) return null;
    return {
      tokensLimit: row.budget_tokens_limit,
      usdLimit: row.budget_usd_limit,
      period: row.budget_period as BudgetPeriod,
      warnedPeriod: row.budget_warned_period,
      adapterName: row.adapter_name,
    };
  },
```

> Note: `setBudget` clears `budget_warned_period` to NULL — a budget change is a config change, so the 80% warning is re-evaluated against the new limit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @prospero/main test -- repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/repository.ts apps/main/src/agents/repository.test.ts
git commit -m "feat(budget): add setBudget/setPermissions/getBudgetState to agents repo"
```

---

## Task 3: Period helpers + `getAgentPeriodTotal`

**Files:**
- Create: `apps/main/src/costs/period.ts`
- Create: `apps/main/src/costs/period.test.ts`
- Modify: `apps/main/src/costs/repository.ts`
- Modify: `apps/main/src/costs/repository.test.ts`
- Modify: `apps/main/tests/costs.enforce-budget.test.ts` (mock patch — see Step 7)

- [ ] **Step 1: Write the failing period-helper tests**

Create `apps/main/src/costs/period.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { periodKey, utcMonthBounds } from "./period.js";

describe("periodKey", () => {
  it("formats a daily key as YYYY-MM-DD in UTC", () => {
    expect(periodKey("daily", new Date(Date.UTC(2026, 4, 18, 23, 59)))).toBe("2026-05-18");
  });
  it("formats a monthly key as YYYY-MM in UTC", () => {
    expect(periodKey("monthly", new Date(Date.UTC(2026, 4, 1)))).toBe("2026-05");
  });
  it("zero-pads single-digit months and days", () => {
    expect(periodKey("daily", new Date(Date.UTC(2026, 0, 3)))).toBe("2026-01-03");
  });
});

describe("utcMonthBounds", () => {
  it("returns the first of the month to the first of the next month", () => {
    const { start, end } = utcMonthBounds(new Date(Date.UTC(2026, 4, 18)));
    expect(start).toBe(Date.UTC(2026, 4, 1));
    expect(end).toBe(Date.UTC(2026, 5, 1));
  });
  it("rolls the year over in December", () => {
    const { start, end } = utcMonthBounds(new Date(Date.UTC(2026, 11, 31)));
    expect(start).toBe(Date.UTC(2026, 11, 1));
    expect(end).toBe(Date.UTC(2027, 0, 1));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @prospero/main test -- period.test.ts`
Expected: FAIL — `./period.js` does not exist.

- [ ] **Step 3: Implement `period.ts`**

Create `apps/main/src/costs/period.ts`:

```ts
// Period math for per-agent budgets (M12 PR-E2). Daily and monthly windows
// are UTC. periodKey is the dedup key for the 80% budget Inbox warning.

import type { BudgetPeriod } from "@prospero/shared";

export const utcMonthBounds = (now: Date): { start: number; end: number } => {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = Date.UTC(y, m, 1);
  const end = m === 11 ? Date.UTC(y + 1, 0, 1) : Date.UTC(y, m + 1, 1);
  return { start, end };
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

export const periodKey = (period: BudgetPeriod, now: Date): string => {
  const y = String(now.getUTCFullYear());
  const m = pad2(now.getUTCMonth() + 1);
  if (period === "monthly") return `${y}-${m}`;
  return `${y}-${m}-${pad2(now.getUTCDate())}`;
};
```

- [ ] **Step 4: Run the period tests to verify they pass**

Run: `pnpm --filter @prospero/main test -- period.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `getAgentPeriodTotal` test**

Append to `apps/main/src/costs/repository.test.ts` (follow the file's existing setup helper for an in-memory DB + a `cost_events` insert). Add:

```ts
describe("getAgentPeriodTotal", () => {
  it("sums daily and monthly windows for an agent", () => {
    const { repo, companyId, agentId } = setup();
    const insertAt = (occurredAt: number): void => {
      repo.insert({
        companyId,
        agentId,
        projectId: null,
        issueId: null,
        adapterName: "claude-api-key-local",
        model: "claude-sonnet-4-6",
        sessionId: null,
        inputTokens: 100,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        costCentsEstimate: 7,
        occurredAt,
      });
    };
    insertAt(Date.UTC(2026, 4, 18, 9)); // in-day + in-month
    insertAt(Date.UTC(2026, 4, 3, 9)); // earlier same month, not same day
    const now = new Date(Date.UTC(2026, 4, 18, 12));
    expect(repo.getAgentPeriodTotal(agentId, "daily", now)).toEqual({ tokens: 100, cents: 7 });
    expect(repo.getAgentPeriodTotal(agentId, "monthly", now)).toEqual({ tokens: 200, cents: 14 });
  });
});
```

> If `apps/main/src/costs/repository.test.ts` has no shared `setup()` returning `{ repo, companyId, agentId }`, model one on the in-memory DB + migrations pattern from `apps/main/tests/ipc.costs-handlers.test.ts` lines 20–38.

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main test -- costs/repository.test.ts`
Expected: FAIL — `getAgentPeriodTotal` is not on the repository.

- [ ] **Step 7: Implement `getAgentPeriodTotal` and patch `CostsRepository` mocks**

In `apps/main/src/costs/repository.ts`:

Add imports at the top:

```ts
import type { BudgetPeriod } from "@prospero/shared";
import { utcMonthBounds } from "./period.js";
```

Add the method signature to the `CostsRepository` type (after `listRunsByAgent`):

```ts
  getAgentPeriodTotal(agentId: string, period: BudgetPeriod, now: Date): CostTotal;
```

Add the implementation (after `listRunsByAgent`, reusing the existing `sumAgentDayStmt` — it is a generic agent + time-range sum):

```ts
  const getAgentPeriodTotal = (agentId: string, period: BudgetPeriod, now: Date): CostTotal => {
    const { start, end } = period === "monthly" ? utcMonthBounds(now) : utcDayBounds(now);
    const row = sumAgentDayStmt.get(agentId, start, end) as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_cents_estimate: number;
    };
    return { tokens: totalTokens(row), cents: row.cost_cents_estimate };
  };
```

Add `getAgentPeriodTotal` to the returned object:

```ts
  return {
    insert,
    getAgentDailyTotal,
    getIssueTotal,
    hasAgentRowsForDay,
    listRunsByAgent,
    getAgentPeriodTotal,
  };
```

Now patch the `CostsRepository` mocks broken by the interface change. Run:
`grep -rln "getIssueTotal" apps/main/tests apps/main/src --include=*.test.ts`
For every `costsRepo` object literal in the results, add this line:

```ts
    getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
```

The known one is `apps/main/tests/costs.enforce-budget.test.ts` (the `makeDeps` base mock). That whole file is rewritten in Task 4 — but patch it here too so Task 3 commits typecheck-clean.

- [ ] **Step 8: Run the tests + typecheck**

Run: `pnpm --filter @prospero/main test -- costs/repository.test.ts && pnpm -r typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 9: Commit**

```bash
git add apps/main/src/costs/ apps/main/tests/costs.enforce-budget.test.ts
git commit -m "feat(budget): add period helpers and getAgentPeriodTotal"
```

---

## Task 4: Per-agent enforcement in `checkAndPause`

**Files:**
- Modify: `apps/main/src/costs/enforce-budget.ts`
- Test: `apps/main/tests/costs.enforce-budget.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the enforce-budget test**

Replace the entire contents of `apps/main/tests/costs.enforce-budget.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { checkAndPause } from "../src/costs/enforce-budget.js";
import type { EnforceBudgetDeps } from "../src/costs/enforce-budget.js";
import { periodKey } from "../src/costs/period.js";

const makeDeps = (overrides: Partial<EnforceBudgetDeps> = {}): EnforceBudgetDeps => ({
  costsRepo: {
    insert: vi.fn(),
    getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
    getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
    hasAgentRowsForDay: vi.fn().mockReturnValue(false),
    listRunsByAgent: vi.fn().mockReturnValue([]),
    getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
  },
  budgetsRepo: {
    read: vi.fn().mockReturnValue({
      maxTokensPerDayPerAgent: 1000,
      maxTokensPerIssue: 500,
      rateLimitWindowTokens: 100000,
      rateLimitWindowHours: 5,
    }),
    write: vi.fn(),
    resetDefaults: vi.fn(),
  },
  pauseAgent: vi.fn(),
  notifySecurityAlert: vi.fn(),
  recordPauseActivity: vi.fn(),
  getBudgetState: vi.fn().mockReturnValue(null),
  notifyBudgetWarning: vi.fn(),
  markBudgetWarned: vi.fn(),
  ...overrides,
});

const ctx = { companyId: "co_1", agentId: "agent_x", issueId: null as string | null };

describe("checkAndPause — global M8 caps (unchanged)", () => {
  it("no-ops when daily and per-issue are under limits", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 500, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, { ...ctx, issueId: "iss_1" });
    expect(r.paused).toBe(false);
    expect(deps.pauseAgent).not.toHaveBeenCalled();
  });

  it("pauses + alerts when daily exceeds cap", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 1500, cents: 5 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_daily");
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_daily");
  });

  it("pauses when per-issue exceeds cap (daily fine)", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 600, cents: 1 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, { ...ctx, issueId: "iss_1" });
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_issue");
  });
});

describe("checkAndPause — per-agent budget", () => {
  it("no-ops when the agent has no per-agent limits", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: null,
        usdLimit: null,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(false);
    expect(deps.costsRepo.getAgentPeriodTotal).not.toHaveBeenCalled();
  });

  it("pauses with budget_exceeded_agent when the token cap is hit", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 1000, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_agent");
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_agent");
    expect(deps.notifySecurityAlert).toHaveBeenCalledTimes(1);
  });

  it("warns once at 80% and records the period key", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 850, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(false);
    expect(deps.notifyBudgetWarning).toHaveBeenCalledTimes(1);
    expect(deps.markBudgetWarned).toHaveBeenCalledWith(
      "agent_x",
      periodKey("daily", new Date()),
    );
  });

  it("does not re-warn when warnedPeriod already matches the current period", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: periodKey("daily", new Date()),
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 850, cents: 0 }),
      },
    });
    checkAndPause(deps, ctx);
    expect(deps.notifyBudgetWarning).not.toHaveBeenCalled();
  });

  it("re-warns after a period rollover (stale warnedPeriod)", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: "2020-01-01",
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 850, cents: 0 }),
      },
    });
    checkAndPause(deps, ctx);
    expect(deps.notifyBudgetWarning).toHaveBeenCalledTimes(1);
  });

  it("does NOT enforce the USD cap on an OAuth adapter", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: null,
        usdLimit: 100,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 999 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(false);
    expect(deps.notifyBudgetWarning).not.toHaveBeenCalled();
  });

  it("enforces the USD cap on a claude-api-key adapter", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: null,
        usdLimit: 100,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-api-key-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 100 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_agent");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main test -- costs.enforce-budget.test.ts`
Expected: FAIL — the per-agent describe block fails; `EnforceBudgetDeps` has no `getBudgetState`/`notifyBudgetWarning`/`markBudgetWarned`.

- [ ] **Step 3: Implement per-agent enforcement**

Replace the contents of `apps/main/src/costs/enforce-budget.ts` with:

```ts
// Called after each cost recorder.recordTurn to enforce soft-stop budgets.
// M8: global daily-per-agent + per-issue caps. M12 PR-E2: a per-agent budget
// (token or USD, daily or monthly) layered on top — 80% raises an Inbox
// warning, 100% pauses. The per-agent cap is additive: the global cap is the
// floor, the per-agent cap is a tighter ceiling. Pause is "soft" — the current
// turn already happened; the next enqueue is parked by router.

import type { BudgetPeriod } from "@prospero/shared";
import type { CostsRepository } from "./repository.js";
import type { BudgetsRepository } from "./budgets-repository.js";
import type { AgentBudgetState } from "../agents/repository.js";
import { periodKey } from "./period.js";

export type PauseReason =
  | "budget_exceeded_daily"
  | "budget_exceeded_issue"
  | "budget_exceeded_agent";

export type BudgetWarningInput = {
  companyId: string;
  agentId: string;
  metric: "tokens" | "usd";
  used: number;
  limit: number;
  period: BudgetPeriod;
};

export type EnforceBudgetDeps = {
  costsRepo: CostsRepository;
  budgetsRepo: BudgetsRepository;
  pauseAgent: (agentId: string, reason: PauseReason) => void;
  notifySecurityAlert: (input: {
    companyId: string;
    agentId: string;
    reason: PauseReason;
    tokens: number;
    limit: number;
    issueId: string | null;
  }) => void;
  recordPauseActivity: (input: { companyId: string; agentId: string; reason: PauseReason }) => void;
  getBudgetState: (agentId: string) => AgentBudgetState | null;
  notifyBudgetWarning: (input: BudgetWarningInput) => void;
  markBudgetWarned: (agentId: string, periodKey: string) => void;
};

export type EnforceBudgetContext = {
  companyId: string;
  agentId: string;
  issueId: string | null;
};

export type EnforceBudgetResult =
  | { paused: false }
  | { paused: true; reason: PauseReason; tokens: number; limit: number };

export const checkAndPause = (
  deps: EnforceBudgetDeps,
  ctx: EnforceBudgetContext,
): EnforceBudgetResult => {
  const budgets = deps.budgetsRepo.read();

  // --- M8 global daily cap ---
  const daily = deps.costsRepo.getAgentDailyTotal(ctx.agentId, new Date());
  if (daily.tokens > budgets.maxTokensPerDayPerAgent) {
    const reason: PauseReason = "budget_exceeded_daily";
    deps.pauseAgent(ctx.agentId, reason);
    deps.notifySecurityAlert({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      reason,
      tokens: daily.tokens,
      limit: budgets.maxTokensPerDayPerAgent,
      issueId: null,
    });
    deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
    return { paused: true, reason, tokens: daily.tokens, limit: budgets.maxTokensPerDayPerAgent };
  }

  // --- M8 global per-issue cap ---
  if (ctx.issueId !== null) {
    const issueTotal = deps.costsRepo.getIssueTotal(ctx.issueId);
    if (issueTotal.tokens > budgets.maxTokensPerIssue) {
      const reason: PauseReason = "budget_exceeded_issue";
      deps.pauseAgent(ctx.agentId, reason);
      deps.notifySecurityAlert({
        companyId: ctx.companyId,
        agentId: ctx.agentId,
        reason,
        tokens: issueTotal.tokens,
        limit: budgets.maxTokensPerIssue,
        issueId: ctx.issueId,
      });
      deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
      return { paused: true, reason, tokens: issueTotal.tokens, limit: budgets.maxTokensPerIssue };
    }
  }

  // --- M12 PR-E2 per-agent budget ---
  const budget = deps.getBudgetState(ctx.agentId);
  if (budget !== null && (budget.tokensLimit !== null || budget.usdLimit !== null)) {
    const now = new Date();
    const total = deps.costsRepo.getAgentPeriodTotal(ctx.agentId, budget.period, now);
    // USD is only enforced on cost-bearing adapters; OAuth has no real $ cost.
    const costBearing = budget.adapterName.startsWith("claude-api-key");

    const tokenOver = budget.tokensLimit !== null && total.tokens >= budget.tokensLimit;
    const usdOver = costBearing && budget.usdLimit !== null && total.cents >= budget.usdLimit;
    if (tokenOver || usdOver) {
      const reason: PauseReason = "budget_exceeded_agent";
      const tokens = tokenOver ? total.tokens : total.cents;
      const limit = tokenOver ? budget.tokensLimit! : budget.usdLimit!;
      deps.pauseAgent(ctx.agentId, reason);
      deps.notifySecurityAlert({
        companyId: ctx.companyId,
        agentId: ctx.agentId,
        reason,
        tokens,
        limit,
        issueId: null,
      });
      deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
      return { paused: true, reason, tokens, limit };
    }

    // 80% — one Inbox warning per period, deduped via budget_warned_period.
    const key = periodKey(budget.period, now);
    if (budget.warnedPeriod !== key) {
      const tokenWarn = budget.tokensLimit !== null && total.tokens >= 0.8 * budget.tokensLimit;
      const usdWarn =
        costBearing && budget.usdLimit !== null && total.cents >= 0.8 * budget.usdLimit;
      if (tokenWarn || usdWarn) {
        deps.notifyBudgetWarning({
          companyId: ctx.companyId,
          agentId: ctx.agentId,
          metric: tokenWarn ? "tokens" : "usd",
          used: tokenWarn ? total.tokens : total.cents,
          limit: tokenWarn ? budget.tokensLimit! : budget.usdLimit!,
          period: budget.period,
        });
        deps.markBudgetWarned(ctx.agentId, key);
      }
    }
  }

  return { paused: false };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main test -- costs.enforce-budget.test.ts`
Expected: PASS (all global + per-agent cases).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/costs/enforce-budget.ts apps/main/tests/costs.enforce-budget.test.ts
git commit -m "feat(budget): enforce per-agent token and usd caps in checkAndPause"
```

---

## Task 5: Wire the new enforcement deps in orchestrator-handlers

`checkAndPause` now needs three new deps. They are assembled in the `enforceDeps` object in `apps/main/src/ipc/orchestrator-handlers.ts` (the `agents` and `inbox` repositories are already in scope as `agents` and `inbox`).

**Files:**
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

- [ ] **Step 1: Update the `notifySecurityAlert` callback for the third pause reason**

In `apps/main/src/ipc/orchestrator-handlers.ts`, find the `notifySecurityAlert` callback inside `enforceDeps`. Replace its `limitDesc` line:

```ts
    const limitDesc = input.reason === "budget_exceeded_daily" ? "diário" : "por issue";
```

with:

```ts
    const limitDesc =
      input.reason === "budget_exceeded_daily"
        ? "diário"
        : input.reason === "budget_exceeded_issue"
          ? "por issue"
          : "do agente";
```

- [ ] **Step 2: Add the three new deps to `enforceDeps`**

In the same `enforceDeps` object, after the `recordPauseActivity` callback, add:

```ts
  getBudgetState: (agentId) => agents.getBudgetState(agentId),
  markBudgetWarned: (agentId, key) => {
    agents.setBudgetWarnedPeriod(agentId, key);
  },
  notifyBudgetWarning: (input) => {
    const periodLabel = input.period === "daily" ? "diário" : "mensal";
    const fmt = (v: number): string =>
      input.metric === "tokens" ? `${String(v)} tokens` : `$${(v / 100).toFixed(2)}`;
    inbox.create({
      companyId: input.companyId,
      kind: "budget_warning",
      actorId: input.agentId,
      title: `Orçamento ${periodLabel} do agente em 80%`,
      preview: `Uso: ${fmt(input.used)} de ${fmt(input.limit)}`,
      payloadJson: JSON.stringify(input),
      requiresAction: false,
    });
  },
```

- [ ] **Step 3: Typecheck and run the main suite**

Run: `pnpm --filter @prospero/main typecheck && pnpm --filter @prospero/main test`
Expected: clean typecheck + PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(budget): wire per-agent enforcement deps into the orchestrator"
```

---

## Task 6: Run Policy filter — `applyRunPolicy` + build-args

**Files:**
- Modify: `packages/shared/src/capabilities.ts`
- Test: `packages/shared/tests/capabilities.test.ts` (create if absent)
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`
- Test: `apps/main/tests/orchestrator.build-args.test.ts`

- [ ] **Step 1: Write the failing `applyRunPolicy` test**

Create (or append to) `packages/shared/tests/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyRunPolicy } from "../src/capabilities.js";

const ALL = [
  "mcp__dashboard__hire_agent",
  "mcp__dashboard__fire_agent",
  "mcp__dashboard__message_agent",
  "mcp__dashboard__list_agents",
  "mcp__dashboard__read_thread",
  "mcp__dashboard__assign_issue",
  "mcp__dashboard__create_issue",
];

describe("applyRunPolicy", () => {
  it("returns the list unchanged when both flags are true", () => {
    expect(applyRunPolicy(ALL, { canHire: true, canAssign: true })).toEqual(ALL);
  });

  it("removes hire_agent and fire_agent when canHire is false", () => {
    const out = applyRunPolicy(ALL, { canHire: false, canAssign: true });
    expect(out).not.toContain("mcp__dashboard__hire_agent");
    expect(out).not.toContain("mcp__dashboard__fire_agent");
    expect(out).toContain("mcp__dashboard__message_agent");
    expect(out).toContain("mcp__dashboard__list_agents");
    expect(out).toContain("mcp__dashboard__assign_issue");
  });

  it("removes assign_issue when canAssign is false", () => {
    const out = applyRunPolicy(ALL, { canHire: true, canAssign: false });
    expect(out).not.toContain("mcp__dashboard__assign_issue");
    expect(out).toContain("mcp__dashboard__create_issue");
    expect(out).toContain("mcp__dashboard__hire_agent");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/shared test -- capabilities.test.ts`
Expected: FAIL — `applyRunPolicy` is not exported.

- [ ] **Step 3: Implement `applyRunPolicy`**

In `packages/shared/src/capabilities.ts`, add after `resolveCapabilityTools`:

```ts
// M12 PR-E2: Run Policy is a fine sub-toggle of the delegation/issues
// capabilities. It only ever *removes* tools from the resolved list — never
// adds. Applied after resolveCapabilityTools, at spawn time.
export const applyRunPolicy = (
  tools: string[],
  policy: { canHire: boolean; canAssign: boolean },
): string[] => {
  let out = tools;
  if (!policy.canHire) {
    out = out.filter(
      (t) => t !== "mcp__dashboard__hire_agent" && t !== "mcp__dashboard__fire_agent",
    );
  }
  if (!policy.canAssign) {
    out = out.filter((t) => t !== "mcp__dashboard__assign_issue");
  }
  return out;
};
```

Verify `applyRunPolicy` is reachable from `@prospero/shared` — `capabilities.ts` is already re-exported (the package exports `resolveCapabilityTools`). If the package index lists named exports explicitly rather than `export *`, add `applyRunPolicy` to that list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/shared test -- capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `applyRunPolicy` into `build-args.ts`**

In `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`:

Add `applyRunPolicy` to the existing `@prospero/shared` import.

Replace the line:

```ts
  const allowedTools = resolveCapabilityTools(agent.capabilities);
```

with:

```ts
  const allowedTools = applyRunPolicy(resolveCapabilityTools(agent.capabilities), {
    canHire: agent.canHire,
    canAssign: agent.canAssign,
  });
```

- [ ] **Step 6: Add a build-args test for the policy filter**

Append to `apps/main/tests/orchestrator.build-args.test.ts` (inside the `describe("buildClaudeArgs")` block). `baseAgent` already has `canHire`/`canAssign` (added in Task 1, Step 6):

```ts
  it("drops hire/fire tools from --allowedTools when canHire is false", () => {
    const agent = { ...baseAgent, capabilities: ["delegation", "issues"], canHire: false };
    const args = buildClaudeArgs(agent, "/tmp/mcp.json");
    const allowed = args[args.indexOf("--allowedTools") + 1]!;
    expect(allowed).not.toContain("mcp__dashboard__hire_agent");
    expect(allowed).not.toContain("mcp__dashboard__fire_agent");
    expect(allowed).toContain("mcp__dashboard__message_agent");
    expect(allowed).toContain("mcp__dashboard__assign_issue");
  });

  it("drops assign_issue from --allowedTools when canAssign is false", () => {
    const agent = { ...baseAgent, capabilities: ["delegation", "issues"], canAssign: false };
    const args = buildClaudeArgs(agent, "/tmp/mcp.json");
    const allowed = args[args.indexOf("--allowedTools") + 1]!;
    expect(allowed).not.toContain("mcp__dashboard__assign_issue");
    expect(allowed).toContain("mcp__dashboard__hire_agent");
  });
```

- [ ] **Step 7: Run the build-args test**

Run: `pnpm --filter @prospero/main test -- orchestrator.build-args.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/capabilities.ts packages/shared/tests/capabilities.test.ts apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts apps/main/tests/orchestrator.build-args.test.ts
git commit -m "feat(policy): filter hire/fire/assign tools by run policy"
```

---

## Task 7: IPC — channels, handlers, preload, typings

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/src/types/costs.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`
- Modify: `apps/main/src/ipc/costs-handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`
- Test: `apps/main/tests/ipc.costs-handlers.test.ts`

- [ ] **Step 1: Add the `AgentBudgetStatus` type**

In `packages/shared/src/types/costs.ts`, add an import for `BudgetPeriod` and the new type:

```ts
import type { BudgetPeriod } from "./agent.js";

// M12 PR-E2: live snapshot of an agent's per-agent budget utilisation, for
// the Budget section in the Stats tab. Derived from cost_events.
export type AgentBudgetStatus = {
  period: BudgetPeriod;
  tokenTotal: number;
  tokenLimit: number | null;
  usdTotalCents: number;
  usdLimitCents: number | null;
  adapterIsCostBearing: boolean;
};
```

- [ ] **Step 2: Add the three IPC channels**

In `packages/shared/src/ipc-channels.ts`, add to the `IPC` object (after `AGENTS_SET_CAPABILITIES`):

```ts
  AGENTS_SET_BUDGET: "agents:set-budget",
  AGENTS_SET_PERMISSIONS: "agents:set-permissions",
```

and after `RUNS_LIST`:

```ts
  COSTS_GET_AGENT_BUDGET_STATUS: "costs:get-agent-budget-status",
```

- [ ] **Step 3: Write the failing handler test**

Append to `apps/main/tests/ipc.costs-handlers.test.ts` (the `setup()` helper already creates an `agent` and registers the costs handlers):

```ts
  it("costs:get-agent-budget-status reflects the agent's period total", () => {
    const { db, companyId, agentId, costsRepo } = setup();
    const agents = createAgentsRepository(db);
    agents.setBudget(agentId, { tokensLimit: 1000, usdLimit: 500, period: "daily" });
    costsRepo.insert({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      inputTokens: 300,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 12,
      occurredAt: Date.now(),
    });
    const handler = handlers.get("costs:get-agent-budget-status")!;
    const result = handler(null, { agentId }) as {
      tokenTotal: number;
      tokenLimit: number | null;
      usdTotalCents: number;
      usdLimitCents: number | null;
      adapterIsCostBearing: boolean;
    };
    expect(result.tokenTotal).toBe(300);
    expect(result.tokenLimit).toBe(1000);
    expect(result.usdTotalCents).toBe(12);
    expect(result.usdLimitCents).toBe(500);
    expect(result.adapterIsCostBearing).toBe(false);
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main test -- ipc.costs-handlers.test.ts`
Expected: FAIL — `handlers.get("costs:get-agent-budget-status")` is `undefined`.

- [ ] **Step 5: Implement the `costs:get-agent-budget-status` handler**

In `apps/main/src/ipc/costs-handlers.ts`:

Add imports:

```ts
import { createAgentsRepository } from "../agents/repository.js";
import { createCostsRepository } from "../costs/repository.js";
```

Add `AgentBudgetStatus` to the existing `@prospero/shared` type import.

Inside `registerCostsHandlers`, after `const budgetsRepo = createBudgetsRepository(db);`, add:

```ts
  const agentsRepo = createAgentsRepository(db);
  const costsRepo = createCostsRepository(db);
```

After the `COSTS_SET_BUDGETS` handler, add:

```ts
  ipcMain.handle(
    IPC.COSTS_GET_AGENT_BUDGET_STATUS,
    (_e, payload: { agentId: string }): AgentBudgetStatus => {
      const agent = agentsRepo.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      const total = costsRepo.getAgentPeriodTotal(payload.agentId, agent.budgetPeriod, new Date());
      return {
        period: agent.budgetPeriod,
        tokenTotal: total.tokens,
        tokenLimit: agent.budgetTokensLimit,
        usdTotalCents: total.cents,
        usdLimitCents: agent.budgetUsdLimit,
        adapterIsCostBearing: agent.adapterName.startsWith("claude-api-key"),
      };
    },
  );
```

- [ ] **Step 6: Run the handler test**

Run: `pnpm --filter @prospero/main test -- ipc.costs-handlers.test.ts`
Expected: PASS.

- [ ] **Step 7: Add the `agents:set-budget` and `agents:set-permissions` handlers**

In `apps/main/src/ipc/orchestrator-handlers.ts`, find the `AGENTS_SET_CAPABILITIES` handler. After it, add (`restartIfRunning` is already defined in this file; `BudgetPeriod` must be added to the `@prospero/shared` import):

```ts
  ipcMain.handle(
    IPC.AGENTS_SET_BUDGET,
    (
      _e,
      payload: {
        agentId: string;
        tokensLimit: number | null;
        usdLimit: number | null;
        period: BudgetPeriod;
      },
    ): { ok: true } => {
      if (payload.period !== "daily" && payload.period !== "monthly") {
        throw new Error("Invalid budget period");
      }
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      // Repo throws on a non-positive, non-null limit.
      agents.setBudget(payload.agentId, {
        tokensLimit: payload.tokensLimit,
        usdLimit: payload.usdLimit,
        period: payload.period,
      });
      // No re-spawn: enforcement reads the DB each turn post-completion.
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.AGENTS_SET_PERMISSIONS,
    (_e, payload: { agentId: string; canHire: boolean; canAssign: boolean }): { ok: true } => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setPermissions(payload.agentId, {
        canHire: payload.canHire,
        canAssign: payload.canAssign,
      });
      // can_hire/can_assign affect --allowedTools at spawn → re-spawn.
      restartIfRunning(payload.agentId, agent.companyId);
      return { ok: true };
    },
  );
```

- [ ] **Step 8: Add the preload bridge methods**

In `apps/main/src/ipc/preload.ts`:

Add `AgentBudgetStatus` to the existing `@prospero/shared` type import (next to `AgentRunRow`).

In the `agents:` namespace, after `setCapabilities`, add:

```ts
    setBudget: (
      agentId: string,
      tokensLimit: number | null,
      usdLimit: number | null,
      period: "daily" | "monthly",
    ) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_BUDGET, {
        agentId,
        tokensLimit,
        usdLimit,
        period,
      }) as Promise<{ ok: true }>,
    setPermissions: (agentId: string, canHire: boolean, canAssign: boolean) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_PERMISSIONS, {
        agentId,
        canHire,
        canAssign,
      }) as Promise<{ ok: true }>,
```

In the `costs:` namespace, after `setBudgets`, add:

```ts
    getAgentBudgetStatus: (agentId: string) =>
      ipcRenderer.invoke(IPC.COSTS_GET_AGENT_BUDGET_STATUS, { agentId }) as Promise<AgentBudgetStatus>,
```

- [ ] **Step 9: Add the renderer typings**

In `apps/renderer/src/env.d.ts`:

Add `AgentBudgetStatus` to the top-of-file `@prospero/shared` type import.

In the `agents:` namespace block, after `setCapabilities`, add:

```ts
        setBudget: (
          agentId: string,
          tokensLimit: number | null,
          usdLimit: number | null,
          period: "daily" | "monthly",
        ) => Promise<{ ok: true }>;
        setPermissions: (
          agentId: string,
          canHire: boolean,
          canAssign: boolean,
        ) => Promise<{ ok: true }>;
```

In the `costs:` namespace block, after `setBudgets`, add:

```ts
        getAgentBudgetStatus: (agentId: string) => Promise<AgentBudgetStatus>;
```

- [ ] **Step 10: Typecheck and test**

Run: `pnpm -r typecheck && pnpm --filter @prospero/main test -- ipc.costs-handlers.test.ts`
Expected: clean typecheck + PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(budget): add set-budget, set-permissions and budget-status IPCs"
```

---

## Task 8: Renderer store actions

**Files:**
- Modify: `apps/renderer/src/stores/agents.ts`

- [ ] **Step 1: Add the store-action type signatures**

In `apps/renderer/src/stores/agents.ts`, in the store-state type (where `setMode`/`setCapabilities` are declared, ~line 22-24), add:

```ts
  setBudget: (
    agentId: string,
    tokensLimit: number | null,
    usdLimit: number | null,
    period: "daily" | "monthly",
  ) => Promise<void>;
  setPermissions: (agentId: string, canHire: boolean, canAssign: boolean) => Promise<void>;
```

- [ ] **Step 2: Implement the store actions**

In the same file, after the `setCapabilities` action implementation (~line 119), add:

```ts
  setBudget: async (agentId, tokensLimit, usdLimit, period) => {
    await window.prospero.agents.setBudget(agentId, tokensLimit, usdLimit, period);
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? {
              ...a,
              budgetTokensLimit: tokensLimit,
              budgetUsdLimit: usdLimit,
              budgetPeriod: period,
            }
          : a,
      ),
    }));
  },
  setPermissions: async (agentId, canHire, canAssign) => {
    await window.prospero.agents.setPermissions(agentId, canHire, canAssign);
    // set-permissions re-spawns (clears the session) — reload the roster.
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
```

> `reloadAgentsForCompany` and the `get`/`set` signature are already used by `setMode` in this file — match that pattern exactly.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/stores/agents.ts
git commit -m "feat(budget): add setBudget and setPermissions store actions"
```

---

## Task 9: ConfigTab — Run Policy section

Relocate the Mode and Always-On controls into a new "Run Policy" section and add the `can_hire`/`can_assign` toggles. The `setMode`/`setAlwaysOn` IPCs are unchanged — only the controls move.

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`

- [ ] **Step 1: Remove the standalone Mode and Always-On sections**

In `apps/renderer/src/components/agent-panel/ConfigTab.tsx`, delete the two `<section>` blocks for Mode (currently lines ~200-217) and Always On (currently lines ~219-229).

- [ ] **Step 2: Add the `setPermissions` store hook**

After `const setAlwaysOn = useAgentsStore((s) => s.setAlwaysOn);` add:

```ts
  const setPermissions = useAgentsStore((s) => s.setPermissions);
```

- [ ] **Step 3: Add the Run Policy section**

In the JSX, insert this `<section>` where the Mode section used to be (between the Location section and the Schedule section):

```tsx
      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.runPolicy.label")}
        </h3>
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
              {t("agent.config.mode.label")}
            </p>
            <div className="flex gap-3 text-xs">
              {(["supervised", "auto"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name={`mode-${agent.id}`}
                    checked={agent.mode === m}
                    onChange={() => void setMode(agent.id, m)}
                  />
                  {t(`agent.config.mode.${m}`)}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={agent.alwaysOn}
              onChange={(e) => void setAlwaysOn(agent.id, e.target.checked)}
            />
            <span className="text-ink">{t("agent.config.alwaysOn.label")}</span>
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={agent.canHire}
              onChange={(e) => void setPermissions(agent.id, e.target.checked, agent.canAssign)}
            />
            <span className="text-ink">{t("agent.config.runPolicy.canHire")}</span>
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={agent.canAssign}
              onChange={(e) => void setPermissions(agent.id, agent.canHire, e.target.checked)}
            />
            <span className="text-ink">{t("agent.config.runPolicy.canAssign")}</span>
          </label>
        </div>
        <p className="text-[10px] text-ink-soft mt-2">{t("agent.config.runPolicy.hint")}</p>
      </section>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/components/agent-panel/ConfigTab.tsx
git commit -m "feat(policy): consolidate mode, always-on, hire and assign into Run Policy"
```

---

## Task 10: StatsTab — Budget section

**Files:**
- Create: `apps/renderer/src/components/agent-panel/BudgetSection.tsx`
- Modify: `apps/renderer/src/components/agent-panel/StatsTab.tsx`

- [ ] **Step 1: Create the `BudgetSection` component**

Create `apps/renderer/src/components/agent-panel/BudgetSection.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { AgentBudgetStatus, BudgetPeriod } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = { agentId: string };

const pct = (used: number, limit: number | null): number => {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
};

const Bar: FC<{ percent: number }> = ({ percent }) => {
  const color =
    percent >= 100
      ? "bg-semantic-danger"
      : percent >= 80
        ? "bg-semantic-warning"
        : "bg-brand";
  return (
    <div className="h-1.5 w-full rounded bg-surface-soft overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${String(percent)}%` }} />
    </div>
  );
};

export const BudgetSection: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const setBudget = useAgentsStore((s) => s.setBudget);
  const [status, setStatus] = useState<AgentBudgetStatus | null>(null);
  const [tokensInput, setTokensInput] = useState("");
  const [usdInput, setUsdInput] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("daily");
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const s = await window.prospero.costs.getAgentBudgetStatus(agentId);
    setStatus(s);
    setTokensInput(s.tokenLimit === null ? "" : String(s.tokenLimit));
    setUsdInput(s.usdLimitCents === null ? "" : String(s.usdLimitCents / 100));
    setPeriod(s.period);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await window.prospero.costs.getAgentBudgetStatus(agentId);
      if (cancelled) return;
      setStatus(s);
      setTokensInput(s.tokenLimit === null ? "" : String(s.tokenLimit));
      setUsdInput(s.usdLimitCents === null ? "" : String(s.usdLimitCents / 100));
      setPeriod(s.period);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const save = async (): Promise<void> => {
    setError(null);
    let tokensLimit: number | null = null;
    if (tokensInput.trim() !== "") {
      const n = Number(tokensInput);
      if (!Number.isInteger(n) || n <= 0) {
        setError(t("agent.stats.budget.invalid"));
        return;
      }
      tokensLimit = n;
    }
    let usdLimit: number | null = null;
    if (usdInput.trim() !== "") {
      const d = Number(usdInput);
      if (!Number.isFinite(d) || d <= 0) {
        setError(t("agent.stats.budget.invalid"));
        return;
      }
      usdLimit = Math.round(d * 100);
    }
    await setBudget(agentId, tokensLimit, usdLimit, period);
    await load();
  };

  if (status === null) return null;

  return (
    <div className="border-t border-surface-border pt-3">
      <div className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
        {t("agent.stats.budget.label")}
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <div className="flex justify-between text-[10px] text-ink-soft mb-1">
            <span>{t("agent.stats.budget.tokens")}</span>
            <span className="tabular-nums">
              {formatTokens(status.tokenTotal)}
              {status.tokenLimit !== null
                ? ` / ${formatTokens(status.tokenLimit)} (${String(pct(status.tokenTotal, status.tokenLimit))}%)`
                : ` / ${t("agent.stats.budget.unset")}`}
            </span>
          </div>
          <Bar percent={pct(status.tokenTotal, status.tokenLimit)} />
        </div>

        <div>
          <div className="flex justify-between text-[10px] text-ink-soft mb-1">
            <span>
              {t("agent.stats.budget.usd")}
              {!status.adapterIsCostBearing && ` · ${t("agent.stats.budget.informational")}`}
            </span>
            <span className="tabular-nums">
              {formatCents(status.usdTotalCents)}
              {status.usdLimitCents !== null
                ? ` / ${formatCents(status.usdLimitCents)} (${String(pct(status.usdTotalCents, status.usdLimitCents))}%)`
                : ` / ${t("agent.stats.budget.unset")}`}
            </span>
          </div>
          <Bar percent={pct(status.usdTotalCents, status.usdLimitCents)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-soft">{t("agent.stats.budget.tokenLimit")}</span>
          <input
            type="number"
            value={tokensInput}
            onChange={(e) => setTokensInput(e.target.value)}
            placeholder={t("agent.stats.budget.unset")}
            className="px-2 py-1 border border-surface-border rounded bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-soft">{t("agent.stats.budget.usdLimit")}</span>
          <input
            type="number"
            value={usdInput}
            onChange={(e) => setUsdInput(e.target.value)}
            placeholder={t("agent.stats.budget.unset")}
            className="px-2 py-1 border border-surface-border rounded bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-soft">{t("agent.stats.budget.period")}</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}
            className="px-2 py-1 border border-surface-border rounded bg-surface"
          >
            <option value="daily">{t("agent.stats.budget.daily")}</option>
            <option value="monthly">{t("agent.stats.budget.monthly")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void save()}
          className="self-end px-3 py-1 bg-brand text-white rounded text-xs"
        >
          {t("agent.stats.budget.save")}
        </button>
      </div>
      {error !== null && <p className="mt-1 text-[10px] text-semantic-danger">{error}</p>}
    </div>
  );
};
```

- [ ] **Step 2: Mount `BudgetSection` in StatsTab**

In `apps/renderer/src/components/agent-panel/StatsTab.tsx`:

Add the import:

```ts
import { BudgetSection } from "./BudgetSection.js";
```

Render it just before the closing `</div>` of the component, after the `<Link to="/costs">`:

```tsx
      <BudgetSection agentId={agentId} />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/agent-panel/BudgetSection.tsx apps/renderer/src/components/agent-panel/StatsTab.tsx
git commit -m "feat(budget): add the Budget section to the agent Stats tab"
```

---

## Task 11: i18n keys

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

- [ ] **Step 1: Add the Run Policy keys**

In **both** files, inside `agent.config`, add a `runPolicy` object next to `mode`/`alwaysOn`.

`en-US.json`:

```json
"runPolicy": {
  "label": "Run Policy",
  "hint": "Controls how this agent runs and what it may delegate.",
  "canHire": "Can hire and fire agents",
  "canAssign": "Can assign issues to others"
}
```

`pt-BR.json`:

```json
"runPolicy": {
  "label": "Política de Execução",
  "hint": "Controla como este agente roda e o que ele pode delegar.",
  "canHire": "Pode contratar e demitir agentes",
  "canAssign": "Pode atribuir issues a outros"
}
```

- [ ] **Step 2: Add the Budget keys**

In **both** files, inside `agent.stats`, add a `budget` object.

`en-US.json`:

```json
"budget": {
  "label": "Budget",
  "tokens": "Tokens this period",
  "usd": "Cost this period",
  "informational": "informational",
  "period": "Period",
  "daily": "Daily",
  "monthly": "Monthly",
  "tokenLimit": "Token limit",
  "usdLimit": "USD limit ($)",
  "unset": "no limit",
  "save": "Save",
  "invalid": "Enter a positive number."
}
```

`pt-BR.json`:

```json
"budget": {
  "label": "Orçamento",
  "tokens": "Tokens no período",
  "usd": "Custo no período",
  "informational": "informativo",
  "period": "Período",
  "daily": "Diário",
  "monthly": "Mensal",
  "tokenLimit": "Limite de tokens",
  "usdLimit": "Limite em USD ($)",
  "unset": "sem limite",
  "save": "Salvar",
  "invalid": "Informe um número positivo."
}
```

- [ ] **Step 3: Run the i18n parity test**

Run: `pnpm --filter @prospero/renderer test -- parity.test.ts`
Expected: PASS — both files have the identical key set.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(budget): add i18n keys for Run Policy and Budget"
```

---

## Task 12: Non-regression sweep + ROADMAP

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Full typecheck, lint, and test**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: all clean / PASS. The test count grows by roughly: period (5) + agents repo budget (8) + costs repo period (1) + enforce-budget per-agent (7, replacing some) + applyRunPolicy (3) + build-args policy (2) + costs handler budget-status (1). Investigate and fix any failure before continuing — do not proceed with a red suite.

- [ ] **Step 2: Confirm token non-regression**

PR-E2 must be token-neutral. Confirm by inspection: `composeSystemPrompt` is untouched; `applyRunPolicy` only ever shrinks `--allowedTools`; enforcement runs post-turn against the DB. There is no new system-prompt content. State this explicitly when reporting completion.

- [ ] **Step 3: Update `ROADMAP.md`**

Mark M12 PR-E2 (per-agent Budget + Run Policy) as done in `ROADMAP.md`, following the format used for PR-E1 and the earlier M12 PRs. Update both sections that `ROADMAP.md` requires per the project's roadmap-sync rule (the `roadmap.html` pitch page is **not** touched — only `ROADMAP.md`).

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): mark M12 PR-E2 budget and run policy done"
```

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill. PRs go directly to `main` per the project workflow (no feature branch).

---

## Self-Review

**Spec coverage (vs. `2026-05-18-m12-pr-e-runs-budget-policy-design.md`):**
- §2.1 six columns / migration `0026` → Task 1.
- §2.2 `getAgentPeriodTotal` + `utcMonthBounds` → Task 3.
- §2.3 `periodKey` dedup → Task 3 (`period.ts`) + Task 4 (used in `checkAndPause`).
- §2.4 `checkAndPause` per-agent enforcement, `budget_exceeded_agent`, new deps → Task 4 + Task 5.
- §2.5 `budget_warning` inbox kind + dedup → Task 1 (kind) + Task 5 (`notifyBudgetWarning`).
- §2.6 Budget UI section + `agents:set-budget` + `costs:get-agent-budget-status` → Task 7 + Task 10.
- §3.1 `can_hire`/`can_assign` columns → Task 1.
- §3.2 `build-args` filter → Task 6.
- §3.3 Run Policy UI section + `agents:set-permissions` → Task 7 + Task 9.
- §4.1 migration → Task 1. §4.2 `Agent` type (with the documented `CreateAgentInput` trim) → Task 1. §4.3 repo methods → Task 2 + Task 3.
- §5 tests → covered per task. §6 security: Run Policy only removes tools; budget is additive — preserved by design.

**Type consistency check:** `BudgetPeriod` (`"daily" | "monthly"`) is defined once in `packages/shared/src/types/agent.ts` and imported everywhere (`period.ts`, `costs.ts`, `repository.ts`, `enforce-budget.ts`). `AgentBudgetState` (main-only, includes `warnedPeriod`) is exported from `agents/repository.ts` and consumed by `enforce-budget.ts`. `AgentBudgetStatus` (shared, UI-facing, no `warnedPeriod`) lives in `types/costs.ts`. Method names are consistent across tasks: `setBudget`, `setBudgetWarnedPeriod`, `setPermissions`, `getBudgetState`, `getAgentPeriodTotal`, `applyRunPolicy`, `periodKey`, `utcMonthBounds`. The `EnforceBudgetDeps` shape in the Task 4 test mock matches the type defined in the Task 4 implementation (`getBudgetState`, `notifyBudgetWarning`, `markBudgetWarned`).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result.
