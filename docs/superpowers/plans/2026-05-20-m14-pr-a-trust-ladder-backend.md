# M14 PR-A — Trust Ladder Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-tier trust ladder (`novato` / `confiavel` / `autonomo`) backed by `agents.trust_tier` + a `trust_events` audit log + a reactive engine that promotes/demotes from M13 verification signals; the gate auto-approves read-only tools for non-novato agents; `autonomo` promotion is human-approved via a new `trust_promotion_suggested` inbox card. **Backend only — no UI in this PR.**

**Architecture:** A pure function `evaluateTier(record, currentTier)` decides the eligible tier from a `TrackRecord` collected via read-only SQL JOINs (no stored score). The engine runs reactively on goal/approval/verification events and either applies a promotion immediately (novato→confiavel) or files an inbox card (confiavel→autonomo). The gate gets ONE new rule fired BEFORE the path-fence: non-novato + `isReadOnlyTool` ⇒ allow + audit. Run Policy `mode` is set/reverted by the engine when crossing the autonomo boundary; the user retains manual override.

**Tech Stack:** TypeScript (strict + `exactOptionalPropertyTypes`), Electron, better-sqlite3, MCP, vitest. pnpm workspace layout: `apps/main`, `apps/renderer`, `apps/agent-runner`, `packages/shared`.

**Spec:** `docs/superpowers/specs/2026-05-18-m14-vitrine-confianca-design.md` — §4 (Escada), §7 (data/migrations), §11 row A (PR-A scope), §13 (security). M13 PR-A..F all merged. HEAD at plan time: `553c18a`.

**Locked design decisions:**
- **Bundled PR on `main`.** Same pattern as M13 PR-E/PR-F.
- **No `CHECK` constraint on `agents.trust_tier`** — M13 §5.1 convention; a new tier value is a TS-only change.
- **`inbox_items.kind` HAS a `CHECK`** — confirmed empirically in M13 PR-F Task 4 (migration `0031`). Adding `trust_promotion_suggested` requires a table recreate (mirror `0031`).
- **`score` is NOT stored.** `TrackRecord` is computed from existing tables. Stale state is impossible.
- **The engine is fired by call sites** in M13 (`applyVerificationReport`), approvals, and the gate-deny path. NO cron, NO polling.
- **Promotion `novato→confiavel` is automatic and visible** (event row + future Vitrine line); `confiavel→autonomo` is human-approved via the inbox.
- **Demotion is immediate and non-blocking** (security first — §13).
- **`isReadOnlyTool` covers ONLY** `Read`, `Glob`, `Grep`, and MCP tools whose names start with `list_` / end with `_read` / are explicitly tagged non-destructive (`isa_read`, `telos_read`, etc.). `Write`/`Edit`/`Bash`/`MultiEdit`/`NotebookEdit` are always excluded.
- **Zod schemas in `apps/main/src/schemas/`**, never in `@prospero/shared` (project lesson).
- **Token efficiency:** PR-A adds ZERO to any agent system prompt. Confirm with grep in Task 12.
- **Out of scope** for PR-A: any UI (badge, history panel, inbox card render) — that's PR-B. Briefing/Vitrine — that's PR-C. Calibration of thresholds beyond the defaults locked here.

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `apps/main/src/db/migrations/0032_m14_trust_tier.sql` | `agents.trust_tier` column + `trust_events` table + `idx_trust_events_agent` |
| `apps/main/src/db/migrations/0032.test.ts` | Migration smoke: column exists, table exists, default novato, index present |
| `apps/main/src/db/migrations/0033_m14_inbox_trust_promotion.sql` | Add `trust_promotion_suggested` to `inbox_items.kind` CHECK (mirror 0031) |
| `apps/main/src/db/migrations/0033.test.ts` | Migration smoke: new kind accepted, unknown kind rejected, `idx_inbox_company_unread` preserved |
| `packages/shared/src/types/trust.ts` | `TrustTier` union + `TrackRecord` + `TierEvaluation` + `TrustEvent` types |
| `apps/main/src/trust/evaluate.ts` (+ `.test.ts`) | Pure `evaluateTier(record, current)` + thresholds |
| `apps/main/src/trust/track-record.ts` (+ `.test.ts`) | `collectTrackRecord(db, agentId, opts)` — read-only SQL |
| `apps/main/src/trust/engine.ts` (+ `.test.ts`) | `recomputeAgentTrust(db, agentId, deps)` — calls evaluate, writes events, applies promotion/demotion |
| `apps/main/src/trust/repository.ts` (+ `.test.ts`) | `TrustEventsRepository` — insert + listByAgent |
| `apps/main/src/trust/read-only-tools.ts` (+ `.test.ts`) | `isReadOnlyTool(toolName)` classifier |
| `apps/main/src/ipc/trust-handlers.ts` (+ `apps/main/tests/trust-handlers.test.ts`) | IPC `trust:get-history` + `trust:approve-promotion` |

**Modified files:**

| File | Change |
|------|--------|
| `packages/shared/src/types/agent.ts` | `Agent` += `trustTier: TrustTier` |
| `apps/main/src/agents/repository.ts` | row→Agent maps `trust_tier`; `setTrustTier(id, tier)` method |
| `packages/shared/src/types/inbox.ts` | `InboxKind` += `"trust_promotion_suggested"` |
| `packages/shared/src/types/activity.ts` | `ACTIVITY_ACTIONS` += `"trust.promoted"`, `"trust.demoted"`, `"trust.promotion_suggested"`, `"trust.readonly_autoapproved"` |
| `apps/main/src/activity/schemas.ts` | Zod schemas for the 4 new activity actions |
| `packages/shared/src/ipc-channels.ts` | `TRUST_GET_HISTORY: "trust:get-history"`, `TRUST_APPROVE_PROMOTION: "trust:approve-promotion"` |
| `apps/main/src/security/gate.ts` | New rule before path-fence in `evaluatePermission`: non-novato + read-only tool ⇒ allow + audit |
| `apps/main/tests/security.gate.test.ts` (or sibling) | New trust-ladder gate tests |
| `apps/main/src/verification/index.ts` | After each `applyVerificationReport`, call `recomputeAgentTrust` for the goal owner |
| `apps/main/src/ipc/handlers.ts` | `registerTrustHandlers(db)` |
| `apps/main/src/ipc/preload.ts` + `apps/renderer/src/env.d.ts` | Expose `trust.getHistory` / `trust.approvePromotion` |

**Why this split:**
- `evaluate.ts` is the only pure module — independently testable, no DB.
- `track-record.ts` does the SQL JOINs — separated so `evaluate.ts` stays pure.
- `engine.ts` is the reactive glue — calls both, writes events, applies side effects.
- `repository.ts` is row-level CRUD for `trust_events` — mirrors every other repo.
- `read-only-tools.ts` is a one-function classifier — needs its own unit tests because it's the load-bearing safety boundary of the gate rule.

---

## Task 1: Migration `0032` — `trust_tier` + `trust_events`

**Files:**
- Create: `apps/main/src/db/migrations/0032_m14_trust_tier.sql`
- Create: `apps/main/src/db/migrations/0032.test.ts`

> Read `apps/main/src/db/migrations/0030_m13_criterion_attempts.sql` and `apps/main/src/db/migrations/0030.test.ts` as the closest precedent (ADD COLUMN + a tiny table). Migration test files live next to the SQL files (`NNNN.test.ts` convention, M13 PR-A lesson).

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/db/migrations/0032.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0032 — trust_tier + trust_events", () => {
  it("adds trust_tier column defaulting to 'novato' on existing agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    // Seed a minimal company + agent using the existing column order.
    const now = Date.now();
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      now,
    );
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(now, now);
    const row = db.prepare("SELECT trust_tier FROM agents WHERE id = ?").get("a1") as {
      trust_tier: string;
    };
    expect(row.trust_tier).toBe("novato");
  });

  it("creates trust_events with the kind CHECK and FK to agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
       VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(Date.now(), Date.now());

    // Valid kind: accepted.
    db.prepare(
      `INSERT INTO trust_events (id, agent_id, kind, from_tier, to_tier, reason, created_at)
       VALUES ('e1','a1','promoted','novato','confiavel','5 verified outcomes',?)`,
    ).run(Date.now());

    // Invalid kind: rejected by CHECK.
    expect(() =>
      db.prepare(
        `INSERT INTO trust_events (id, agent_id, kind, from_tier, to_tier, reason, created_at)
         VALUES ('e2','a1','exploded','novato','confiavel','no',?)`,
      ).run(Date.now()),
    ).toThrow(/CHECK constraint failed/);

    // Index exists.
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
      .get("idx_trust_events_agent");
    expect(idx).toBeDefined();
  });
});
```

Run: `pnpm --filter @prospero/main test "0032"`
Expected: FAIL — migration file does not exist.

- [ ] **Step 2: Write the migration SQL**

Create `apps/main/src/db/migrations/0032_m14_trust_tier.sql`:

```sql
-- M14 PR-A Task 1: trust ladder backend.
-- Adds agents.trust_tier (no CHECK — M13 §5.1 convention: new enum value is a
-- TS-only change) + a trust_events audit table. defer_foreign_keys is not
-- needed here (additive only — ADD COLUMN + CREATE TABLE).

ALTER TABLE agents ADD COLUMN trust_tier TEXT NOT NULL DEFAULT 'novato';

CREATE TABLE trust_events (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL
                CHECK (kind IN ('promoted','demoted','promotion_suggested')),
  from_tier   TEXT NOT NULL,
  to_tier     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_trust_events_agent ON trust_events(agent_id);
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "0032"`
Expected: PASS — 2 cases.

- [ ] **Step 4: Run the full migrations suite**

Run: `pnpm --filter @prospero/main test "migration"`
Expected: PASS — every existing migration test still green; the new one adds 2.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/db/migrations/0032_m14_trust_tier.sql apps/main/src/db/migrations/0032.test.ts
git commit -m "feat(trust): add trust_tier column and trust_events table"
```

---

## Task 2: Migration `0033` — `trust_promotion_suggested` inbox kind

**Files:**
- Create: `apps/main/src/db/migrations/0033_m14_inbox_trust_promotion.sql`
- Create: `apps/main/src/db/migrations/0033.test.ts`

> Read `apps/main/src/db/migrations/0031_inbox_security_zone_blocked_kind.sql` AND `0031.test.ts` end-to-end. Copy the recreate pattern verbatim, then append `trust_promotion_suggested` to the `kind` CHECK list. Migration recreate of `inbox_items` MUST preserve `idx_inbox_company_unread` (M12 PR-E2 + M13 PR-F lessons).

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/db/migrations/0033.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0033 — trust_promotion_suggested inbox kind", () => {
  const setup = () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    return db;
  };

  it("accepts the new kind", () => {
    const db = setup();
    db.prepare(
      "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?,?,?,?,?,?)",
    ).run("i1", "c1", "trust_promotion_suggested", "Promote?", 1, Date.now());
    const row = db
      .prepare("SELECT kind FROM inbox_items WHERE id = ?")
      .get("i1") as { kind: string };
    expect(row.kind).toBe("trust_promotion_suggested");
  });

  it("still rejects an unknown kind", () => {
    const db = setup();
    expect(() =>
      db.prepare(
        "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?,?,?,?,?,?)",
      ).run("i2", "c1", "definitely_not_a_kind", "x", 0, Date.now()),
    ).toThrow(/CHECK constraint failed/);
  });

  it("preserves idx_inbox_company_unread", () => {
    const db = setup();
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
      .get("idx_inbox_company_unread");
    expect(idx).toBeDefined();
  });
});
```

Run: `pnpm --filter @prospero/main test "0033"`
Expected: FAIL — migration file does not exist.

- [ ] **Step 2: Write the migration SQL**

Create `apps/main/src/db/migrations/0033_m14_inbox_trust_promotion.sql` by copying `0031` and adding ONE entry to the CHECK list:

```sql
-- M14 PR-A Task 2: add the `trust_promotion_suggested` inbox kind.
-- SQLite cannot ALTER a CHECK constraint, so `inbox_items` is recreated.
-- defer_foreign_keys per the M8 PR-A convention.

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
      'budget_warning',
      'verification_failed',
      'verification_review',
      'security_zone_blocked',
      'trust_promotion_suggested'
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

CREATE INDEX IF NOT EXISTS idx_inbox_company_unread
  ON inbox_items(company_id, read_at);
```

(Copy the entire CHECK list verbatim from `0031` — exactly 18 prior kinds — and append `trust_promotion_suggested` as the 19th. Do not invent new entries.)

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "0033"`
Expected: PASS — 3 cases.

- [ ] **Step 4: Run the inbox/security suite as regression**

Run: `pnpm --filter @prospero/main test inbox security`
Expected: PASS — every prior inbox+security test still green; M13 PR-F's `0031` test still passes.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/db/migrations/0033_m14_inbox_trust_promotion.sql apps/main/src/db/migrations/0033.test.ts
git commit -m "feat(trust): add trust_promotion_suggested inbox kind"
```

---

## Task 3: Shared types `trust.ts`

**Files:**
- Create: `packages/shared/src/types/trust.ts`
- Modify: `packages/shared/src/types/index.ts` (add `export * from "./trust.js"`)
- Modify: `packages/shared/src/types/agent.ts` (`Agent.trustTier`)
- Modify: `packages/shared/src/types/inbox.ts` (`InboxKind` += `"trust_promotion_suggested"`)

> Read `packages/shared/src/types/agent.ts` first to see the current `Agent` shape. Read `packages/shared/src/types/inbox.ts` for the `InboxKind` union extension idiom (already extended by M13 PR-F for `security_zone_blocked`).

- [ ] **Step 1: Create the trust types file**

Create `packages/shared/src/types/trust.ts`:

```typescript
// M14 PR-A — shared trust types. The score is NOT a stored field — `TrackRecord`
// is computed on demand from existing tables (goals/goal_criteria/approvals/
// activity_events). `evaluateTier` is the only authority for the eligible tier.

export type TrustTier = "novato" | "confiavel" | "autonomo";

export type TrustEventKind = "promoted" | "demoted" | "promotion_suggested";

export interface TrustEvent {
  id: string;
  agentId: string;
  kind: TrustEventKind;
  fromTier: TrustTier;
  toTier: TrustTier;
  reason: string;
  createdAt: number;
}

export interface TrackRecord {
  /** Goals reached 'achieved' (all ISCs green) where this agent owned/contributed. */
  verifiedOutcomes: number;
  /** 0..1 — ISCs that passed without retrabalho. NaN-safe: defaults to 0 if total=0. */
  iscFirstPassRate: number;
  approvalsAccepted: number;
  approvalsRejected: number;
  /** Failures of any ISC the agent worked, inside the trust window. */
  verificationFailures: number;
  /** True iff a `demoted` event exists inside the trust window. */
  demotedInWindow: boolean;
}

export interface TierEvaluation {
  current: TrustTier;
  eligible: TrustTier;
  /** Non-null when current === eligible AND a stricter tier was almost reached but blocked. */
  blockedReason: string | null;
}
```

- [ ] **Step 2: Export from the shared index**

In `packages/shared/src/types/index.ts`, add the line in alphabetical order (or at the natural spot — read the file first):

```typescript
export * from "./trust.js";
```

- [ ] **Step 3: Extend `Agent`**

In `packages/shared/src/types/agent.ts`, modify the `Agent` type adding the field. Place it near `mode` / `alwaysOn` since it's part of the same "policy" cluster:

```typescript
import type { TrustTier } from "./trust.js";
// ...
export type Agent = {
  // ...existing fields...
  trustTier: TrustTier;
  // ...rest of existing fields...
};
```

(Confirm the exact location in the existing file; do not duplicate the type definition.)

- [ ] **Step 4: Extend `InboxKind`**

In `packages/shared/src/types/inbox.ts`, append `"trust_promotion_suggested"` to the `InboxKind` union literal. The file already has `"security_zone_blocked"` from M13 PR-F — add the new kind right after that one to mirror the migration order.

- [ ] **Step 5: Run typechecks**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/main typecheck`
Expected: **EXPECTED TO FAIL** at `apps/main/src/agents/repository.ts` because `Agent` now requires `trustTier` and the row→Agent mapper does not produce it yet. **This failure is the test of Task 4.** Note the error message and proceed to Task 4 without committing yet — they must commit together so no commit is type-broken.

Do **not** commit at the end of Task 3. Task 4 wraps the shared-types change with the row→Agent update; both land in one commit.

---

## Task 4: Repository wiring for `trust_tier`

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/src/agents/repository.test.ts`

> Read `apps/main/src/agents/repository.ts` end-to-end. Locate:
> - The `rowToAgent` mapper (it converts a SQL row to an `Agent`).
> - Every `SELECT` that pulls agent rows — they need `trust_tier` in the column list.
> - The `setMode` method (it's the closest precedent for a tier setter).
> - The `AgentsRepository` interface.

- [ ] **Step 1: Add the test for the mapper and setter**

In `apps/main/src/agents/repository.test.ts`, locate the existing test suite. Add (adapt to the file's setup helpers):

```typescript
it("rowToAgent reads trust_tier — defaults to novato for a fresh hire", () => {
  const { repo } = setup();
  const a = repo.create({ /* whatever the test's existing create helper requires */ });
  expect(a.trustTier).toBe("novato");
});

it("setTrustTier persists the new tier and round-trips through getById", () => {
  const { repo } = setup();
  const a = repo.create({ /* ... */ });
  repo.setTrustTier(a.id, "confiavel");
  expect(repo.getById(a.id)?.trustTier).toBe("confiavel");
});
```

(Use the same `setup` / `create` helpers the file already uses. If `repo.create` takes specific args, copy from an adjacent passing test.)

Run: `pnpm --filter @prospero/main test "agents/repository"`
Expected: FAIL — `setTrustTier` is not a function, and `trustTier` is undefined.

- [ ] **Step 2: Add `trust_tier` to every SELECT**

In `apps/main/src/agents/repository.ts`, find every `db.prepare("SELECT ... FROM agents ...")`. Add `trust_tier` to the column list. There are typically 3–4 of these (list, get-by-id, get-by-company, get-active or similar). Do **all** of them — missing one means some code paths return an Agent without a tier.

- [ ] **Step 3: Update the row→Agent mapper**

Locate `rowToAgent` (or the inline mapping). Add the field:

```typescript
const rowToAgent = (r: AgentRow): Agent => ({
  // ...existing fields...
  trustTier: r.trust_tier as TrustTier,
});
```

Add the import:

```typescript
import type { Agent, AgentMode, BudgetPeriod, TrustTier } from "@prospero/shared";
```

(Adapt to the file's existing import shape — it already imports `Agent`, `AgentMode`, etc.)

If the file has a `type AgentRow` declaration, extend it:

```typescript
type AgentRow = {
  // ...existing...
  trust_tier: string;
};
```

- [ ] **Step 4: Add `setTrustTier` to the interface + implementation**

In the `AgentsRepository` interface (or `export type`), add:

```typescript
setTrustTier(id: string, tier: TrustTier): void;
```

In the factory `createAgentsRepository`, add the implementation. Mirror `setMode` exactly:

```typescript
const setTrustTierStmt = db.prepare(
  "UPDATE agents SET trust_tier = @tier, updated_at = @now WHERE id = @id",
);
// ...inside the returned object...
setTrustTier(id, tier) {
  setTrustTierStmt.run({ id, tier, now: Date.now() });
},
```

(Confirm the `updated_at` pattern matches how `setMode` and `setModel` handle it — they all bump `updated_at`.)

- [ ] **Step 5: Run typecheck + targeted test**

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean (Task 3's typecheck error is now resolved).
Run: `pnpm --filter @prospero/main test "agents/repository"`
Expected: PASS — original tests still green; 2 new green.

- [ ] **Step 6: Audit other repos that build `Agent` literals in tests**

Mock literals of `Agent` in tests under `apps/main/tests/` need `trustTier`. Add the field with default `"novato"` where TypeScript flags them. Use grep:

```
grep -rn "as Agent" apps/main/tests | head -20
```

For each hit, ensure the literal has `trustTier: "novato"`. (Same recurring pattern from `project_m12_pr_a_lessons` — every Agent-shape change touches mock literals in `tests/`.)

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean across all test files.

- [ ] **Step 7: Commit (bundles Task 3 + Task 4)**

```bash
git add packages/shared/src/types/trust.ts packages/shared/src/types/index.ts packages/shared/src/types/agent.ts packages/shared/src/types/inbox.ts apps/main/src/agents/repository.ts apps/main/src/agents/repository.test.ts apps/main/tests
git commit -m "feat(trust): wire trust_tier into the agent repo and shared types"
```

(Adjust the `git add` to the actual test files touched in Step 6.)

---

## Task 5: Activity actions for trust events

**Files:**
- Modify: `packages/shared/src/types/activity.ts`
- Modify: `apps/main/src/activity/schemas.ts`

> Read both files first. `activity.ts` defines `ACTIVITY_ACTIONS` (a `readonly` string-tuple) + `ActivityAction` union. `schemas.ts` has `ActivityPayloads` `satisfies Record<ActivityAction, z.ZodTypeAny>` — the satisfies clause causes a compile error if any action lacks a schema (M12 PR-D2 / M13 PR-D pattern).

- [ ] **Step 1: Add the four actions**

In `packages/shared/src/types/activity.ts`, append to the `ACTIVITY_ACTIONS` tuple:

```typescript
// Trust (4) — M14 PR-A
"trust.promoted",
"trust.demoted",
"trust.promotion_suggested",
"trust.readonly_autoapproved",
```

(Pick the actual array shape from the file — the M13 PR-E entry `"security.zone_blocked"` is the immediate precedent.)

- [ ] **Step 2: Add the matching Zod schemas**

In `apps/main/src/activity/schemas.ts`, add inside `ActivityPayloads`:

```typescript
"trust.promoted": z.object({
  fromTier: z.enum(["novato", "confiavel", "autonomo"]),
  toTier: z.enum(["novato", "confiavel", "autonomo"]),
  reason: z.string(),
}),
"trust.demoted": z.object({
  fromTier: z.enum(["novato", "confiavel", "autonomo"]),
  toTier: z.enum(["novato", "confiavel", "autonomo"]),
  reason: z.string(),
}),
"trust.promotion_suggested": z.object({
  fromTier: z.enum(["novato", "confiavel", "autonomo"]),
  toTier: z.enum(["novato", "confiavel", "autonomo"]),
  reason: z.string(),
  inboxItemId: z.string(),
}),
"trust.readonly_autoapproved": z.object({
  toolName: z.string(),
  // payloadJson hash, not full input — keep audit small.
  inputHash: z.string().optional(),
}),
```

- [ ] **Step 3: Run typecheck (the satisfies clause is the test)**

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean. If `ActivityPayloads satisfies Record<ActivityAction, z.ZodTypeAny>` fails, you missed an action.

- [ ] **Step 4: Run the activity schemas test**

Run: `pnpm --filter @prospero/main test activity/schemas`
Expected: PASS — existing cases still green; no new cases needed (the typecheck is the test).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/activity.ts apps/main/src/activity/schemas.ts
git commit -m "feat(trust): add trust activity actions and zod schemas"
```

---

## Task 6: `TrustEventsRepository` (write + listByAgent)

**Files:**
- Create: `apps/main/src/trust/repository.ts`
- Create: `apps/main/src/trust/repository.test.ts`

> Mirror `apps/main/src/inbox/repository.ts` (simple, recent, single-table). Use `randomUUID()` from `node:crypto` for the id (the agents repo pattern).

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/trust/repository.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createTrustEventsRepository } from "./repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    Date.now(),
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(Date.now(), Date.now());
  return { db, repo: createTrustEventsRepository(db) };
};

describe("TrustEventsRepository", () => {
  it("records a promotion and returns it via listByAgent", () => {
    const { repo } = setup();
    const ev = repo.create({
      agentId: "a1",
      kind: "promoted",
      fromTier: "novato",
      toTier: "confiavel",
      reason: "5 verified outcomes",
    });
    expect(ev.id).toMatch(/.+/);
    const list = repo.listByAgent("a1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      agentId: "a1",
      kind: "promoted",
      fromTier: "novato",
      toTier: "confiavel",
      reason: "5 verified outcomes",
    });
  });

  it("listByAgent returns most-recent first", () => {
    const { repo } = setup();
    const t1 = repo.create({
      agentId: "a1",
      kind: "promoted",
      fromTier: "novato",
      toTier: "confiavel",
      reason: "first",
    });
    const t2 = repo.create({
      agentId: "a1",
      kind: "demoted",
      fromTier: "confiavel",
      toTier: "novato",
      reason: "regression",
    });
    const list = repo.listByAgent("a1");
    expect(list[0]!.id).toBe(t2.id);
    expect(list[1]!.id).toBe(t1.id);
  });
});
```

Run: `pnpm --filter @prospero/main test "trust/repository"`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Write the implementation**

Create `apps/main/src/trust/repository.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { TrustEvent, TrustEventKind, TrustTier } from "@prospero/shared";

export type CreateTrustEventInput = {
  agentId: string;
  kind: TrustEventKind;
  fromTier: TrustTier;
  toTier: TrustTier;
  reason: string;
};

export type TrustEventsRepository = {
  create(input: CreateTrustEventInput): TrustEvent;
  listByAgent(agentId: string): TrustEvent[];
};

type TrustEventRow = {
  id: string;
  agent_id: string;
  kind: TrustEventKind;
  from_tier: TrustTier;
  to_tier: TrustTier;
  reason: string;
  created_at: number;
};

const rowToEvent = (r: TrustEventRow): TrustEvent => ({
  id: r.id,
  agentId: r.agent_id,
  kind: r.kind,
  fromTier: r.from_tier,
  toTier: r.to_tier,
  reason: r.reason,
  createdAt: r.created_at,
});

export const createTrustEventsRepository = (
  db: Database.Database,
): TrustEventsRepository => {
  const insertStmt = db.prepare(
    `INSERT INTO trust_events
       (id, agent_id, kind, from_tier, to_tier, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const listStmt = db.prepare(
    "SELECT id, agent_id, kind, from_tier, to_tier, reason, created_at FROM trust_events WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC",
  );

  return {
    create(input) {
      const id = `te_${randomUUID()}`;
      const now = Date.now();
      insertStmt.run(id, input.agentId, input.kind, input.fromTier, input.toTier, input.reason, now);
      return {
        id,
        agentId: input.agentId,
        kind: input.kind,
        fromTier: input.fromTier,
        toTier: input.toTier,
        reason: input.reason,
        createdAt: now,
      };
    },
    listByAgent(agentId) {
      const rows = listStmt.all(agentId) as TrustEventRow[];
      return rows.map(rowToEvent);
    },
  };
};
```

Note the `ORDER BY created_at DESC, rowid DESC` — the secondary `rowid` tiebreaker prevents flaky ordering when two events are inserted within the same millisecond (lesson `project_m13_pr_b1_lessons`).

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "trust/repository"`
Expected: PASS — 2 cases.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/trust/repository.ts apps/main/src/trust/repository.test.ts
git commit -m "feat(trust): add TrustEventsRepository"
```

---

## Task 7: `evaluateTier` — pure function with thresholds

**Files:**
- Create: `apps/main/src/trust/evaluate.ts`
- Create: `apps/main/src/trust/evaluate.test.ts`

> Pure module — no DB, no I/O. The test is the documentation of every transition.

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/trust/evaluate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { TrackRecord, TrustTier } from "@prospero/shared";
import { evaluateTier } from "./evaluate.js";

const base = (overrides: Partial<TrackRecord> = {}): TrackRecord => ({
  verifiedOutcomes: 0,
  iscFirstPassRate: 0,
  approvalsAccepted: 0,
  approvalsRejected: 0,
  verificationFailures: 0,
  demotedInWindow: false,
  ...overrides,
});

describe("evaluateTier", () => {
  it("0 outcomes → eligible novato", () => {
    expect(evaluateTier(base(), "novato").eligible).toBe("novato");
  });

  it("5 verified outcomes + 0 failures → eligible confiavel", () => {
    expect(evaluateTier(base({ verifiedOutcomes: 5 }), "novato").eligible).toBe("confiavel");
  });

  it("5 verified outcomes WITH a failure → still novato, blockedReason set", () => {
    const ev = evaluateTier(
      base({ verifiedOutcomes: 5, verificationFailures: 1 }),
      "novato",
    );
    expect(ev.eligible).toBe("novato");
    expect(ev.blockedReason).toMatch(/falha/i);
  });

  it("15 outcomes + 0.9 pass-rate + 0 failures + not demoted → eligible autonomo", () => {
    expect(
      evaluateTier(
        base({ verifiedOutcomes: 15, iscFirstPassRate: 0.9 }),
        "confiavel",
      ).eligible,
    ).toBe("autonomo");
  });

  it("15 outcomes + 0.85 pass-rate (under threshold) → eligible confiavel only", () => {
    expect(
      evaluateTier(
        base({ verifiedOutcomes: 15, iscFirstPassRate: 0.85 }),
        "confiavel",
      ).eligible,
    ).toBe("confiavel");
  });

  it("15 outcomes + 0.9 pass-rate but demotedInWindow → confiavel, not autonomo", () => {
    expect(
      evaluateTier(
        base({ verifiedOutcomes: 15, iscFirstPassRate: 0.9, demotedInWindow: true }),
        "confiavel",
      ).eligible,
    ).toBe("confiavel");
  });

  it("current is preserved on the evaluation", () => {
    const ev = evaluateTier(base({ verifiedOutcomes: 5 }), "confiavel");
    expect(ev.current).toBe("confiavel");
  });

  it("autonomo agent with a recent failure → eligible drops to novato", () => {
    const ev = evaluateTier(
      base({ verifiedOutcomes: 20, verificationFailures: 1, iscFirstPassRate: 0.9 }),
      "autonomo",
    );
    expect(ev.eligible).toBe("novato");
  });

  it("blockedReason is null when current === eligible at the top tier", () => {
    expect(
      evaluateTier(
        base({ verifiedOutcomes: 20, iscFirstPassRate: 0.95 }),
        "autonomo",
      ).blockedReason,
    ).toBeNull();
  });
});
```

Run: `pnpm --filter @prospero/main test "trust/evaluate"`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Write the implementation**

Create `apps/main/src/trust/evaluate.ts`:

```typescript
import type { TierEvaluation, TrackRecord, TrustTier } from "@prospero/shared";

// M14 PR-A — thresholds. Concrete but tunable; calibrate with real use.
// "Confiança mal calibrada é pior que sem confiança" — start conservative.
export const CONFIAVEL_MIN_OUTCOMES = 5;
export const AUTONOMO_MIN_OUTCOMES = 15;
export const AUTONOMO_MIN_PASS_RATE = 0.9;

export const evaluateTier = (
  record: TrackRecord,
  current: TrustTier,
): TierEvaluation => {
  let eligible: TrustTier = "novato";
  let blockedReason: string | null = null;

  // Any verification failure in the window resets eligibility to novato.
  // Demotion is the security path: confidence eroded must not stay pending.
  if (record.verificationFailures > 0) {
    return {
      current,
      eligible: "novato",
      blockedReason: `${record.verificationFailures} falha(s) de verificação no período`,
    };
  }

  if (record.verifiedOutcomes >= CONFIAVEL_MIN_OUTCOMES) {
    eligible = "confiavel";
  }

  if (
    eligible === "confiavel" &&
    record.verifiedOutcomes >= AUTONOMO_MIN_OUTCOMES &&
    record.iscFirstPassRate >= AUTONOMO_MIN_PASS_RATE &&
    !record.demotedInWindow
  ) {
    eligible = "autonomo";
  } else if (eligible === "confiavel" && record.verifiedOutcomes >= AUTONOMO_MIN_OUTCOMES) {
    if (record.demotedInWindow) {
      blockedReason = "rebaixamento recente — aguardar o período passar";
    } else if (record.iscFirstPassRate < AUTONOMO_MIN_PASS_RATE) {
      blockedReason = `taxa de primeira tentativa ${(record.iscFirstPassRate * 100).toFixed(0)}% < ${AUTONOMO_MIN_PASS_RATE * 100}% requerido`;
    }
  }

  return { current, eligible, blockedReason };
};
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "trust/evaluate"`
Expected: PASS — 9 cases.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/trust/evaluate.ts apps/main/src/trust/evaluate.test.ts
git commit -m "feat(trust): add evaluateTier pure function with thresholds"
```

---

## Task 8: `collectTrackRecord` — read-only SQL

**Files:**
- Create: `apps/main/src/trust/track-record.ts`
- Create: `apps/main/src/trust/track-record.test.ts`

> Read `apps/main/src/goals/repository.ts` (for `goals` shape), `apps/main/src/goals/criteria-repository.ts` (for `goal_criteria` + the `attempts` column added in M13 PR-D), and `apps/main/src/approvals/repository.ts` (for `approvals.decision`). The `goal_criteria` table has `attempts INTEGER NOT NULL DEFAULT 0` (M13 PR-D) — `iscFirstPassRate` = `count(attempts=1 AND status='passed') / count(status IN ('passed','failed'))`.

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/trust/track-record.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { collectTrackRecord, DEFAULT_WINDOW_MS } from "./track-record.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    now,
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(now, now);
  return { db, now };
};

const seedGoal = (
  db: Database.Database,
  goalId: string,
  ownerAgentId: string,
  status: string,
  now: number,
) => {
  db.prepare(
    "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(goalId, "c1", ownerAgentId, "g", "x", "task", status, now, now);
};

const seedCriterion = (
  db: Database.Database,
  cid: string,
  goalId: string,
  status: string,
  attempts: number,
) => {
  db.prepare(
    "INSERT INTO goal_criteria (id, goal_id, kind, statement, status, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(cid, goalId, "command", "x", status, attempts, Date.now(), Date.now());
};

describe("collectTrackRecord", () => {
  it("returns all-zeros for a brand-new agent", () => {
    const { db } = setup();
    const r = collectTrackRecord(db, "a1");
    expect(r.verifiedOutcomes).toBe(0);
    expect(r.iscFirstPassRate).toBe(0);
    expect(r.verificationFailures).toBe(0);
    expect(r.demotedInWindow).toBe(false);
  });

  it("counts goals reached achieved owned by the agent", () => {
    const { db, now } = setup();
    seedGoal(db, "g1", "a1", "achieved", now);
    seedGoal(db, "g2", "a1", "in_progress", now);
    seedGoal(db, "g3", "a1", "achieved", now);
    const r = collectTrackRecord(db, "a1");
    expect(r.verifiedOutcomes).toBe(2);
  });

  it("computes iscFirstPassRate from goal_criteria across the agent's goals", () => {
    const { db, now } = setup();
    seedGoal(db, "g1", "a1", "achieved", now);
    seedCriterion(db, "c1", "g1", "passed", 1); // first try, passed
    seedCriterion(db, "c2", "g1", "passed", 3); // after 3 attempts, passed
    seedCriterion(db, "c3", "g1", "failed", 2); // failed
    const r = collectTrackRecord(db, "a1");
    // 1 / 3 = 0.333
    expect(r.iscFirstPassRate).toBeCloseTo(1 / 3, 5);
  });

  it("counts verification failures from goal_criteria with status=failed", () => {
    const { db, now } = setup();
    seedGoal(db, "g1", "a1", "in_progress", now);
    seedCriterion(db, "c1", "g1", "failed", 1);
    seedCriterion(db, "c2", "g1", "failed", 2);
    seedCriterion(db, "c3", "g1", "passed", 1);
    const r = collectTrackRecord(db, "a1");
    expect(r.verificationFailures).toBe(2);
  });

  it("counts demotedInWindow from trust_events inside the window", () => {
    const { db, now } = setup();
    db.prepare(
      "INSERT INTO trust_events (id, agent_id, kind, from_tier, to_tier, reason, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("e1", "a1", "demoted", "confiavel", "novato", "x", now - 1000);
    const r = collectTrackRecord(db, "a1");
    expect(r.demotedInWindow).toBe(true);
  });

  it("ignores demotions outside the window", () => {
    const { db, now } = setup();
    db.prepare(
      "INSERT INTO trust_events (id, agent_id, kind, from_tier, to_tier, reason, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("e1", "a1", "demoted", "confiavel", "novato", "x", now - DEFAULT_WINDOW_MS - 60_000);
    const r = collectTrackRecord(db, "a1");
    expect(r.demotedInWindow).toBe(false);
  });
});
```

Run: `pnpm --filter @prospero/main test "trust/track-record"`
Expected: FAIL — module missing.

- [ ] **Step 2: Write the implementation**

Create `apps/main/src/trust/track-record.ts`:

```typescript
import type Database from "better-sqlite3";
import type { TrackRecord } from "@prospero/shared";

// Default trust window: 30 days. Demotions and verification failures inside
// this window count against the agent. Tunable in PR-A — start conservative.
export const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type CollectTrackRecordOpts = {
  /** Defaults to DEFAULT_WINDOW_MS. */
  windowMs?: number;
  /** Defaults to Date.now(). Test seam. */
  now?: number;
};

// Read-only — all queries are SELECT against existing tables (M13 + M7.5 + M9).
// No new state is materialized; calling this twice in a row is identical.
export const collectTrackRecord = (
  db: Database.Database,
  agentId: string,
  opts: CollectTrackRecordOpts = {},
): TrackRecord => {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const since = now - windowMs;

  // 1. Verified outcomes — goals reached 'achieved' for which this agent owned
  //    (owner_agent_id). The M14 spec also discusses "contributed" — for PR-A
  //    we use the owner relation only; richer attribution can refine later.
  const verifiedOutcomes =
    (db
      .prepare(
        "SELECT COUNT(*) AS n FROM goals WHERE owner_agent_id = ? AND status = 'achieved'",
      )
      .get(agentId) as { n: number }).n;

  // 2. ISC first-pass rate — across all goals the agent owns (any status),
  //    of criteria that reached a terminal status (passed/failed), what
  //    fraction passed on the first attempt.
  const isc = db
    .prepare(
      `SELECT
         SUM(CASE WHEN gc.status = 'passed' AND gc.attempts = 1 THEN 1 ELSE 0 END) AS first_pass,
         SUM(CASE WHEN gc.status IN ('passed','failed') THEN 1 ELSE 0 END)         AS terminal
       FROM goal_criteria gc
       JOIN goals g ON g.id = gc.goal_id
       WHERE g.owner_agent_id = ?`,
    )
    .get(agentId) as { first_pass: number | null; terminal: number | null };
  const firstPass = isc.first_pass ?? 0;
  const terminal = isc.terminal ?? 0;
  const iscFirstPassRate = terminal === 0 ? 0 : firstPass / terminal;

  // 3. Approvals (M7.5) — accepted vs rejected. The schema uses
  //    `decision IN ('approve','deny')` per migration 0007.
  const approvals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN decision = 'approve' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN decision = 'deny'    THEN 1 ELSE 0 END) AS rejected
       FROM approvals
       WHERE agent_id = ? AND decided_at IS NOT NULL`,
    )
    .get(agentId) as { accepted: number | null; rejected: number | null };
  const approvalsAccepted = approvals.accepted ?? 0;
  const approvalsRejected = approvals.rejected ?? 0;

  // 4. Verification failures in window — count goal_criteria failures for this
  //    agent's goals where the failure landed inside the window.
  const verificationFailures =
    (db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM goal_criteria gc
         JOIN goals g ON g.id = gc.goal_id
         WHERE g.owner_agent_id = ? AND gc.status = 'failed' AND gc.updated_at >= ?`,
      )
      .get(agentId, since) as { n: number }).n;

  // 5. Demoted in window — any 'demoted' trust_event inside the window.
  const demotedInWindow =
    (db
      .prepare(
        "SELECT COUNT(*) AS n FROM trust_events WHERE agent_id = ? AND kind = 'demoted' AND created_at >= ?",
      )
      .get(agentId, since) as { n: number }).n > 0;

  return {
    verifiedOutcomes,
    iscFirstPassRate,
    approvalsAccepted,
    approvalsRejected,
    verificationFailures,
    demotedInWindow,
  };
};
```

> **Adapt point:** before running the tests, verify the actual column names by reading the existing migrations:
> - `goals` schema → look at `0012_m8_5_goals.sql` (and any subsequent `goals.*` migrations); confirm `owner_agent_id`, `status` column names.
> - `goal_criteria` schema → `0027_m13_isa_criteria.sql` + `0030_m13_criterion_attempts.sql`; confirm `status`, `attempts`, `updated_at` column names.
> - `approvals` schema → `0007_approvals.sql`; confirm `decision`, `agent_id`, `decided_at`.
>
> If any column name differs, fix the SQL in the file BEFORE running the test. The test seed in Step 1 uses the same column names, so if SQL and seed agree, the test passes.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "trust/track-record"`
Expected: PASS — 6 cases.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/trust/track-record.ts apps/main/src/trust/track-record.test.ts
git commit -m "feat(trust): add collectTrackRecord read-only repo"
```

---

## Task 9: `isReadOnlyTool` classifier

**Files:**
- Create: `apps/main/src/trust/read-only-tools.ts`
- Create: `apps/main/src/trust/read-only-tools.test.ts`

> The classifier is the safety boundary of the gate rule (Task 11) — it gates which calls become auto-approved. Get its taxonomy unambiguous BEFORE writing the gate rule.

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/trust/read-only-tools.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isReadOnlyTool } from "./read-only-tools.js";

describe("isReadOnlyTool", () => {
  // Built-in Claude tools — only the literal read-only ones.
  it("Read is read-only", () => expect(isReadOnlyTool("Read")).toBe(true));
  it("Glob is read-only", () => expect(isReadOnlyTool("Glob")).toBe(true));
  it("Grep is read-only", () => expect(isReadOnlyTool("Grep")).toBe(true));
  it("Write is NOT read-only", () => expect(isReadOnlyTool("Write")).toBe(false));
  it("Edit is NOT read-only", () => expect(isReadOnlyTool("Edit")).toBe(false));
  it("Bash is NOT read-only", () => expect(isReadOnlyTool("Bash")).toBe(false));
  it("MultiEdit is NOT read-only", () => expect(isReadOnlyTool("MultiEdit")).toBe(false));
  it("NotebookEdit is NOT read-only", () => expect(isReadOnlyTool("NotebookEdit")).toBe(false));

  // MCP tools — list_*, *_read, and the explicitly allowlisted ones.
  it("list_agents is read-only (list_ prefix)", () =>
    expect(isReadOnlyTool("list_agents")).toBe(true));
  it("list_issues is read-only (list_ prefix)", () =>
    expect(isReadOnlyTool("list_issues")).toBe(true));
  it("isa_read is read-only (allowlisted)", () =>
    expect(isReadOnlyTool("isa_read")).toBe(true));
  it("telos_read is read-only (allowlisted)", () =>
    expect(isReadOnlyTool("telos_read")).toBe(true));
  it("skill_read is read-only (allowlisted)", () =>
    expect(isReadOnlyTool("skill_read")).toBe(true));
  it("memory_read is read-only (allowlisted)", () =>
    expect(isReadOnlyTool("memory_read")).toBe(true));

  // MCP tools that DO have side effects must NOT match.
  it("hire_agent is NOT read-only", () =>
    expect(isReadOnlyTool("hire_agent")).toBe(false));
  it("create_issue is NOT read-only", () =>
    expect(isReadOnlyTool("create_issue")).toBe(false));
  it("update_issue is NOT read-only", () =>
    expect(isReadOnlyTool("update_issue")).toBe(false));
  it("criterion_judge is NOT read-only (write-style judgment)", () =>
    expect(isReadOnlyTool("criterion_judge")).toBe(false));
  it("submit_goal_plan is NOT read-only", () =>
    expect(isReadOnlyTool("submit_goal_plan")).toBe(false));

  // Edge cases.
  it("unknown tool defaults to NOT read-only (conservative)", () =>
    expect(isReadOnlyTool("definitely_not_a_real_tool")).toBe(false));
  it("empty string is NOT read-only", () => expect(isReadOnlyTool("")).toBe(false));
});
```

Run: `pnpm --filter @prospero/main test "read-only-tools"`
Expected: FAIL — module missing.

- [ ] **Step 2: Write the implementation**

Create `apps/main/src/trust/read-only-tools.ts`:

```typescript
// M14 PR-A — classifier used by the trust ladder gate rule. Read-only means
// "no side effect on disk, DB, network, or other agents". A non-read-only
// call NEVER becomes trust-auto-approved — that path is reserved for the
// Run Policy in auto mode (degrau autônomo).
//
// Conservative by default: an unknown tool is NOT read-only. New MCP tools
// must opt in explicitly.

// Built-in Claude tools (file-system or shell).
const BUILTIN_READ_ONLY = new Set(["Read", "Glob", "Grep"]);

// MCP tools explicitly allowlisted (do not match list_/_read patterns or do
// match a non-destructive pattern by coincidence).
const MCP_ALLOWLIST = new Set([
  "isa_read",
  "telos_read",
  "skill_read",
  "memory_read",
]);

export const isReadOnlyTool = (toolName: string): boolean => {
  if (toolName.length === 0) return false;
  if (BUILTIN_READ_ONLY.has(toolName)) return true;
  if (MCP_ALLOWLIST.has(toolName)) return true;
  // list_* tools are by convention read-only (M5 / M11).
  if (toolName.startsWith("list_")) return true;
  return false;
};
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "read-only-tools"`
Expected: PASS — 19 cases.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/trust/read-only-tools.ts apps/main/src/trust/read-only-tools.test.ts
git commit -m "feat(trust): classify built-in and MCP tools as read-only"
```

---

## Task 10: `recomputeAgentTrust` — reactive engine

**Files:**
- Create: `apps/main/src/trust/engine.ts`
- Create: `apps/main/src/trust/engine.test.ts`

> The engine is the orchestration glue. Test it with a real in-memory DB end-to-end — it must (1) update `agents.trust_tier` on automatic promotion/demotion, (2) write a `trust_events` row, (3) record an `activity_events` row, (4) create an inbox card on `confiavel→autonomo`, (5) flip `agents.mode` to `supervised` on demotion-out-of-autonomo, (6) NOT touch `agents.mode` for any other transition (the user retains control).

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/trust/engine.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { recomputeAgentTrust } from "./engine.js";
import { _setRecorderForTest } from "../activity/index.js";
import { _setInboxForTest } from "../inbox/index.js";
import { createInboxRepository } from "../inbox/repository.js";

const seedCompanyAndAgent = (
  db: Database.Database,
  agentId = "a1",
  companyId = "c1",
) => {
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    companyId,
    "Acme",
    now,
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES (?, ?, 'A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(agentId, companyId, now, now);
};

const seedAchievedGoals = (db: Database.Database, agentId: string, n: number) => {
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(`g${i}`, "c1", agentId, "g", "x", "task", "achieved", now, now);
  }
};

describe("recomputeAgentTrust", () => {
  let db: Database.Database;
  let recorded: Array<{ action: string }>;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    recorded = [];
    _setRecorderForTest({
      recordActivity: (input) => {
        recorded.push({ action: input.action });
        return { id: "row" } as never;
      },
    });
    _setInboxForTest(createInboxRepository(db));
  });

  afterEach(() => {
    _setRecorderForTest(null);
    _setInboxForTest(null);
    vi.restoreAllMocks();
  });

  it("promotes novato→confiavel after 5 verified outcomes", () => {
    seedCompanyAndAgent(db);
    seedAchievedGoals(db, "a1", 5);
    const result = recomputeAgentTrust(db, "a1");
    expect(result.applied).toBe("promoted");
    expect(result.newTier).toBe("confiavel");
    const row = db.prepare("SELECT trust_tier FROM agents WHERE id=?").get("a1") as {
      trust_tier: string;
    };
    expect(row.trust_tier).toBe("confiavel");
    expect(db.prepare("SELECT COUNT(*) AS n FROM trust_events").get()).toEqual({ n: 1 });
    expect(recorded.some((r) => r.action === "trust.promoted")).toBe(true);
  });

  it("does not promote when track record is insufficient", () => {
    seedCompanyAndAgent(db);
    seedAchievedGoals(db, "a1", 3);
    const result = recomputeAgentTrust(db, "a1");
    expect(result.applied).toBe("none");
    expect(db.prepare("SELECT COUNT(*) AS n FROM trust_events").get()).toEqual({ n: 0 });
    expect(recorded).toHaveLength(0);
  });

  it("suggests confiavel→autonomo via inbox; does NOT auto-promote", () => {
    seedCompanyAndAgent(db);
    seedAchievedGoals(db, "a1", 15);
    // Seed a goal_criterion so iscFirstPassRate is high enough.
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, kind, statement, status, attempts, created_at, updated_at) VALUES ('c1','g0','command','x','passed',1,?,?)",
    ).run(Date.now(), Date.now());
    // Manually bump the agent to confiavel (the engine targets one step at a time).
    db.prepare("UPDATE agents SET trust_tier='confiavel' WHERE id=?").run("a1");

    const result = recomputeAgentTrust(db, "a1");

    expect(result.applied).toBe("suggested");
    const stillRow = db.prepare("SELECT trust_tier FROM agents WHERE id=?").get("a1") as {
      trust_tier: string;
    };
    expect(stillRow.trust_tier).toBe("confiavel"); // not auto-promoted

    const events = db
      .prepare("SELECT kind FROM trust_events WHERE agent_id=?")
      .all("a1") as Array<{ kind: string }>;
    expect(events.map((e) => e.kind)).toContain("promotion_suggested");

    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE kind=?")
      .all("trust_promotion_suggested") as Array<{ kind: string }>;
    expect(inbox).toHaveLength(1);

    expect(recorded.some((r) => r.action === "trust.promotion_suggested")).toBe(true);
  });

  it("demotes autonomo→novato on a verification failure and reverts mode=supervised", () => {
    seedCompanyAndAgent(db);
    db.prepare("UPDATE agents SET trust_tier='autonomo', mode='auto' WHERE id=?").run("a1");
    seedAchievedGoals(db, "a1", 15);
    // A failure inside the window.
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, kind, statement, status, attempts, created_at, updated_at) VALUES ('c1','g0','command','x','failed',1,?,?)",
    ).run(Date.now(), Date.now());

    const result = recomputeAgentTrust(db, "a1");

    expect(result.applied).toBe("demoted");
    const row = db.prepare("SELECT trust_tier, mode FROM agents WHERE id=?").get("a1") as {
      trust_tier: string;
      mode: string;
    };
    expect(row.trust_tier).toBe("novato");
    expect(row.mode).toBe("supervised");
    expect(recorded.some((r) => r.action === "trust.demoted")).toBe(true);
  });

  it("demotion from confiavel does NOT touch agents.mode", () => {
    seedCompanyAndAgent(db);
    db.prepare("UPDATE agents SET trust_tier='confiavel', mode='supervised' WHERE id=?").run(
      "a1",
    );
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES ('g0','c1','a1','g','x','task','in_progress',?,?)",
    ).run(Date.now(), Date.now());
    db.prepare(
      "INSERT INTO goal_criteria (id, goal_id, kind, statement, status, attempts, created_at, updated_at) VALUES ('c1','g0','command','x','failed',1,?,?)",
    ).run(Date.now(), Date.now());

    const result = recomputeAgentTrust(db, "a1");

    expect(result.applied).toBe("demoted");
    const row = db.prepare("SELECT trust_tier, mode FROM agents WHERE id=?").get("a1") as {
      trust_tier: string;
      mode: string;
    };
    expect(row.trust_tier).toBe("novato");
    // mode untouched — user retains control for non-autonomo transitions.
    expect(row.mode).toBe("supervised");
  });

  it("idempotent — calling twice with the same state produces one event", () => {
    seedCompanyAndAgent(db);
    seedAchievedGoals(db, "a1", 5);
    recomputeAgentTrust(db, "a1");
    recomputeAgentTrust(db, "a1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM trust_events").get()).toEqual({ n: 1 });
  });
});
```

Run: `pnpm --filter @prospero/main test "trust/engine"`
Expected: FAIL — module missing.

- [ ] **Step 2: Write the implementation**

Create `apps/main/src/trust/engine.ts`:

```typescript
import type Database from "better-sqlite3";
import type { TrustTier } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { tryGetInbox } from "../inbox/index.js";
import { broadcastInboxUpdate } from "../ipc/inbox-handlers.js";
import { createTrustEventsRepository } from "./repository.js";
import { collectTrackRecord, type CollectTrackRecordOpts } from "./track-record.js";
import { evaluateTier } from "./evaluate.js";

export type RecomputeResult =
  | { applied: "none" }
  | { applied: "promoted"; newTier: TrustTier }
  | { applied: "demoted"; newTier: TrustTier }
  | { applied: "suggested" };

// M14 PR-A — reactive engine. Called from M13's verification gate after
// applyVerificationReport (and from approvals/gate paths in PR-A Task 12).
// Idempotent: if the eligible tier matches the current tier, returns 'none'.
// Side effects:
//   - promote: writes trust_event, updates agents.trust_tier, records activity
//   - demote: same, plus reverts agents.mode to 'supervised' if leaving autonomo
//   - suggest (confiavel→autonomo only): writes trust_event 'promotion_suggested'
//                                         + inbox card + activity, does NOT
//                                         touch agents.trust_tier or agents.mode
export const recomputeAgentTrust = (
  db: Database.Database,
  agentId: string,
  opts: CollectTrackRecordOpts = {},
): RecomputeResult => {
  const agentsRepo = createAgentsRepository(db, tryGetRecorder() ?? null);
  const agent = agentsRepo.getById(agentId);
  if (agent === null) return { applied: "none" };

  const record = collectTrackRecord(db, agentId, opts);
  const ev = evaluateTier(record, agent.trustTier);

  if (ev.eligible === ev.current) return { applied: "none" };

  const trustRepo = createTrustEventsRepository(db);

  // Promotion to autonomo is suggestion-only — user must approve.
  if (ev.eligible === "autonomo" && ev.current === "confiavel") {
    const inbox = tryGetInbox();
    const inboxItem = inbox?.create({
      companyId: agent.companyId,
      kind: "trust_promotion_suggested",
      actorId: agent.id,
      title: `Promover ${agent.name} para Autônomo?`,
      preview: `Histórico verificado: ${record.verifiedOutcomes} outcomes · ${(record.iscFirstPassRate * 100).toFixed(0)}% de primeira`,
      requiresAction: true,
      payloadJson: JSON.stringify({ agentId: agent.id, fromTier: "confiavel", toTier: "autonomo" }),
    });
    if (inboxItem !== undefined) {
      try {
        broadcastInboxUpdate(agent.companyId);
      } catch (err) {
        console.warn("[trust] broadcastInboxUpdate failed", err);
      }
    }
    trustRepo.create({
      agentId: agent.id,
      kind: "promotion_suggested",
      fromTier: "confiavel",
      toTier: "autonomo",
      reason: `${record.verifiedOutcomes} outcomes verificados · ${(record.iscFirstPassRate * 100).toFixed(0)}% taxa de primeira`,
    });
    tryGetRecorder()?.recordActivity({
      companyId: agent.companyId,
      actor: { kind: "system", id: "trust-engine" },
      action: "trust.promotion_suggested",
      entityKind: "agent",
      entityId: agent.id,
      agentId: agent.id,
      payload: {
        fromTier: "confiavel",
        toTier: "autonomo",
        reason: `verifiedOutcomes=${record.verifiedOutcomes} iscFirstPassRate=${record.iscFirstPassRate.toFixed(2)}`,
        inboxItemId: inboxItem?.id ?? "",
      },
    });
    return { applied: "suggested" };
  }

  // Any other movement is applied immediately.
  const fromTier = ev.current;
  const toTier = ev.eligible;
  const isDemotion = tierRank(toTier) < tierRank(fromTier);

  agentsRepo.setTrustTier(agent.id, toTier);

  // If leaving autonomo via demotion, revert mode to supervised. The user
  // retains manual control for all other transitions.
  if (isDemotion && fromTier === "autonomo") {
    agentsRepo.setMode(agent.id, "supervised");
  }

  const reason = isDemotion
    ? (record.verificationFailures > 0
        ? `${record.verificationFailures} falha(s) de verificação no período`
        : "histórico abaixo do limite")
    : `${record.verifiedOutcomes} outcomes verificados sem falhas`;

  trustRepo.create({
    agentId: agent.id,
    kind: isDemotion ? "demoted" : "promoted",
    fromTier,
    toTier,
    reason,
  });

  tryGetRecorder()?.recordActivity({
    companyId: agent.companyId,
    actor: { kind: "system", id: "trust-engine" },
    action: isDemotion ? "trust.demoted" : "trust.promoted",
    entityKind: "agent",
    entityId: agent.id,
    agentId: agent.id,
    payload: { fromTier, toTier, reason },
  });

  return isDemotion
    ? { applied: "demoted", newTier: toTier }
    : { applied: "promoted", newTier: toTier };
};

const tierRank = (t: TrustTier): number =>
  t === "novato" ? 0 : t === "confiavel" ? 1 : 2;
```

> **Adapt point:** verify `createAgentsRepository`'s constructor signature. If it takes `(db, recorder)` and `recorder` cannot be `null`, swap to pass `tryGetRecorder() ?? undefined` and let the call site default. Read the file before writing.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "trust/engine"`
Expected: PASS — 6 cases.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/trust/engine.ts apps/main/src/trust/engine.test.ts
git commit -m "feat(trust): add recomputeAgentTrust reactive engine"
```

---

## Task 11: Gate rule — read-only auto-approve for non-novato

**Files:**
- Modify: `apps/main/src/security/gate.ts`
- Modify: `apps/main/tests/security.gate.test.ts` (or add a new `security.gate-trust.test.ts`)

> Read `apps/main/src/security/gate.ts` end-to-end. The current `evaluatePermission` has a `Bash` branch and an `FS_TOOLS` branch (extended in M13 PR-E to do the zone check). The trust rule fires BEFORE either — if non-novato + read-only, allow + audit. This must be placed so the always-blocked patterns (M5 §8.3) still win for genuinely sensitive paths.

- [ ] **Step 1: Write the failing tests**

Create `apps/main/tests/security.gate-trust.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@prospero/shared";
import { evaluatePermission } from "../src/security/gate.js";
import { _setRecorderForTest } from "../src/activity/index.js";

const USER_DATA = process.platform === "win32" ? "C:\\UserData" : "/tmp/prospero-userdata";

const baseAgent = (tier: "novato" | "confiavel" | "autonomo"): Agent => ({
  id: "a1",
  companyId: "c1",
  name: "A",
  role: "engineer",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  trustTier: tier,
});

type Rec = { action: string };
let recorded: Rec[];

beforeEach(() => {
  recorded = [];
  _setRecorderForTest({
    recordActivity: (input) => {
      recorded.push({ action: input.action });
      return { id: "row" } as never;
    },
  });
});
afterEach(() => {
  _setRecorderForTest(null);
  vi.restoreAllMocks();
});

describe("trust ladder gate rule", () => {
  it("novato + Read → goes through normal path (supervised → request_user)", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: "/some/project/file.ts" },
      agent: { ...baseAgent("novato"), mode: "supervised" },
      allowedProjectPaths: ["/some/project"],
      agentCwd: "/some/project",
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
  });

  it("confiavel + Read inside allowed → auto-allow with trust reason", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: "/some/project/file.ts" },
      agent: { ...baseAgent("confiavel"), mode: "supervised" },
      allowedProjectPaths: ["/some/project"],
      agentCwd: "/some/project",
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
    expect(r.reason).toMatch(/trust:confiavel-readonly/);
    expect(recorded.some((x) => x.action === "trust.readonly_autoapproved")).toBe(true);
  });

  it("confiavel + Write → still goes through normal path (NOT auto-allowed)", () => {
    const r = evaluatePermission({
      toolName: "Write",
      toolInput: { file_path: "/some/project/file.ts" },
      agent: { ...baseAgent("confiavel"), mode: "supervised" },
      allowedProjectPaths: ["/some/project"],
      agentCwd: "/some/project",
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
    expect(recorded.some((x) => x.action === "trust.readonly_autoapproved")).toBe(false);
  });

  it("confiavel + Read of always-blocked sensitive path → still blocked", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: "/etc/passwd" },
      agent: { ...baseAgent("confiavel"), mode: "auto" },
      allowedProjectPaths: ["/etc"],
      agentCwd: "/etc",
      userDataDir: USER_DATA,
    });
    // The always-blocked list (M5 §8.3) MUST take precedence over the trust auto-allow.
    expect(r.action).not.toBe("allow");
  });

  it("autonomo + Read → auto-allow with trust reason", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: "/some/project/file.ts" },
      agent: { ...baseAgent("autonomo"), mode: "auto" },
      allowedProjectPaths: ["/some/project"],
      agentCwd: "/some/project",
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
    expect(r.reason).toMatch(/trust:/);
  });

  it("Read outside allowed projects → still denied even for confiavel", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: "/other/project/secret.txt" },
      agent: { ...baseAgent("confiavel"), mode: "supervised" },
      allowedProjectPaths: ["/some/project"],
      agentCwd: "/some/project",
      userDataDir: USER_DATA,
    });
    // Path-fence wins — trust does not expand reach, only auto-approves within it.
    expect(r.action).toBe("deny");
  });
});
```

Run: `pnpm --filter @prospero/main test "gate-trust"`
Expected: FAIL — gate does not yet apply the trust rule.

- [ ] **Step 2: Implement the gate rule**

In `apps/main/src/security/gate.ts`, find `evaluatePermission`. Place the new rule **AFTER** the always-blocked-pattern check (which returns `request_user`) **AND AFTER** the path-fence (which can return `deny`), but **BEFORE** the final return that asks the user.

Concretely, the order inside `evaluatePermission` becomes:

1. Existing always-blocked-bash check → `request_user` (unchanged).
2. Existing FS-tools branch: blocked path → `request_user`; outside allowed → `deny`; zone check → `deny` (unchanged).
3. **NEW trust rule** (only after the above passed and the tool is genuinely allowed): non-novato + `isReadOnlyTool` → `allow` + audit.
4. Existing `agent.mode === "auto"` → `allow`.
5. Final `request_user`.

Add the imports:

```typescript
import { isReadOnlyTool } from "../trust/read-only-tools.js";
```

(The recorder is already imported in gate.ts from the M13 PR-E work.)

Add the rule. Locate the line near the end of `evaluatePermission` where the function returns `{ action: "allow" }` for `auto` mode. Insert this block immediately ABOVE that block:

```typescript
// M14 PR-A trust ladder: non-novato agents get auto-approve for read-only
// tools. Always-blocked patterns and the path-fence have already filtered
// the call by this point, so this can only widen approvals inside the
// already-allowed surface.
if (agent.trustTier !== "novato" && isReadOnlyTool(toolName)) {
  try {
    tryGetRecorder()?.recordActivity({
      companyId: agent.companyId,
      actor: { kind: "agent", id: agent.id },
      action: "trust.readonly_autoapproved",
      entityKind: "agent",
      entityId: agent.id,
      agentId: agent.id,
      payload: { toolName },
    });
  } catch (err) {
    console.warn("[gate] failed to record trust.readonly_autoapproved", err);
  }
  return { action: "allow", reason: "trust:confiavel-readonly" };
}
```

(The reason string `trust:confiavel-readonly` is intentional — even at `autonomo`, this rule represents "the read-only carve-out", not full autonomy. The full autonomy is the agent's `mode='auto'`, which the existing rule below handles.)

- [ ] **Step 3: Run the trust gate tests**

Run: `pnpm --filter @prospero/main test "gate-trust"`
Expected: PASS — 6 cases.

- [ ] **Step 4: Run the full security suite as regression**

Run: `pnpm --filter @prospero/main test "security"`
Expected: PASS — every prior gate/zone/blocklist test still green; the 6 new ones now also pass.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/security/gate.ts apps/main/tests/security.gate-trust.test.ts
git commit -m "feat(trust): auto-approve read-only tools for non-novato agents"
```

---

## Task 12: Wire the engine into M13 verification + approvals

**Files:**
- Modify: `apps/main/src/verification/index.ts`
- Modify: `apps/main/src/ipc/permission-handlers.ts` (or the approval-decision call site — confirm)
- Modify: `apps/main/src/verification/index.test.ts`

> The engine has to be CALLED. The two reactive hooks for PR-A are: (a) after a goal verification report is applied (`applyVerificationReport`), recompute the goal owner's trust; (b) after a permission decision is resolved (user approves or rejects), recompute that agent's trust.
>
> Read `apps/main/src/verification/index.ts` `applyVerificationReport` to see where to plug in. Read `apps/main/src/ipc/permission-handlers.ts` (or wherever `resolveApproval` lives) for hook (b).

- [ ] **Step 1: Hook in `applyVerificationReport`**

In `apps/main/src/verification/index.ts`, at the end of `applyVerificationReport`, after the gate has applied the report and after the optional `notify` call:

```typescript
import { recomputeAgentTrust } from "../trust/engine.js";

// ...inside applyVerificationReport, after the existing body:
if (goal.ownerAgentId !== null) {
  try {
    recomputeAgentTrust(db, goal.ownerAgentId);
  } catch (err) {
    console.warn("[verification] recomputeAgentTrust failed", err);
  }
}
```

(Confirm the actual field name — the spec uses `owner_agent_id`; the TS field is likely `ownerAgentId`.)

- [ ] **Step 2: Extend `verification/index.test.ts`**

Add (or extend an existing test) to assert that `applyVerificationReport` triggers a trust recompute. Look at the existing `_setRecorderForTest` setup pattern and reuse it. Minimal assertion: after a verifying→achieved transition for a goal whose owner has 5+ achieved goals, the agent's tier becomes `confiavel`.

```typescript
it("recomputes trust after the gate flips a goal to achieved", () => {
  // setup company + agent + 5 achieved goals already seeded
  // simulate verifying goal #6 transitioning to achieved
  // expect agents.trust_tier === 'confiavel'
});
```

(Adapt to the test file's existing helpers — copy the seeding shape from `engine.test.ts`.)

- [ ] **Step 3: Hook in the approval-decision path**

Grep first to find the resolution call site:

```
grep -rn "resolveApproval\|approval.*resolve\|setDecision\|decision.*approve" apps/main/src
```

Find the function that updates `approvals.decision` when the user approves or rejects. After the update, recompute trust for that agent. Same try/catch wrapper as above. If the resolution call site is fragmented (multiple paths — IPC + auto-resolve + tests), pick the single canonical write to `approvals.decision` and hook there. **Document the location chosen in the commit message** so a future reader can find it.

- [ ] **Step 4: Run targeted tests + typecheck**

Run: `pnpm --filter @prospero/main test verification trust security`
Expected: PASS — every relevant suite still green; the new "recomputes after gate" case green.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/verification apps/main/src/ipc
git commit -m "feat(trust): recompute trust on verification gate and approval decision"
```

(Adjust the `git add` to the real files touched in Step 3.)

---

## Task 13: IPC channels + handlers

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `apps/main/src/ipc/trust-handlers.ts`
- Create: `apps/main/tests/trust-handlers.test.ts`
- Modify: `apps/main/src/ipc/handlers.ts` (register)
- Modify: `apps/main/src/ipc/preload.ts` + `apps/renderer/src/env.d.ts`

> Read `apps/main/src/ipc/security-handlers.ts` (M13 PR-E) end-to-end for the `xHandlers(deps)` + `registerXHandlers(db)` factory pattern. Mirror exactly.

- [ ] **Step 1: Add the two IPC channels**

In `packages/shared/src/ipc-channels.ts`, append:

```typescript
TRUST_GET_HISTORY: "trust:get-history",
TRUST_APPROVE_PROMOTION: "trust:approve-promotion",
```

- [ ] **Step 2: Write the failing handler test**

Create `apps/main/tests/trust-handlers.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { trustHandlers } from "../src/ipc/trust-handlers.js";
import { createTrustEventsRepository } from "../src/trust/repository.js";
import { createInboxRepository } from "../src/inbox/repository.js";
import { _setInboxForTest } from "../src/inbox/index.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    now,
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(now, now);
  db.prepare("UPDATE agents SET trust_tier='confiavel' WHERE id='a1'").run();
  _setInboxForTest(createInboxRepository(db));
  return { db, h: trustHandlers({ db }) };
};

describe("trustHandlers", () => {
  afterEach(() => _setInboxForTest(null));

  it("getHistory returns events in reverse chronological order", () => {
    const { db, h } = setup();
    const repo = createTrustEventsRepository(db);
    repo.create({
      agentId: "a1",
      kind: "promoted",
      fromTier: "novato",
      toTier: "confiavel",
      reason: "first",
    });
    repo.create({
      agentId: "a1",
      kind: "demoted",
      fromTier: "confiavel",
      toTier: "novato",
      reason: "regression",
    });
    const list = h.getHistory({ agentId: "a1" });
    expect(list.length).toBe(2);
    expect(list[0]!.reason).toBe("regression");
  });

  it("approvePromotion flips the agent to autonomo and sets mode=auto", () => {
    const { db, h } = setup();
    // Seed an inbox card so the handler can validate via payload.
    const inbox = createInboxRepository(db);
    const item = inbox.create({
      companyId: "c1",
      kind: "trust_promotion_suggested",
      actorId: "a1",
      title: "Promote?",
      preview: null,
      requiresAction: true,
      payloadJson: JSON.stringify({ agentId: "a1", fromTier: "confiavel", toTier: "autonomo" }),
    });

    const result = h.approvePromotion({ inboxItemId: item.id });

    expect(result.ok).toBe(true);
    const row = db.prepare("SELECT trust_tier, mode FROM agents WHERE id='a1'").get() as {
      trust_tier: string;
      mode: string;
    };
    expect(row.trust_tier).toBe("autonomo");
    expect(row.mode).toBe("auto");
    // Inbox card was marked read.
    const card = db.prepare("SELECT read_at FROM inbox_items WHERE id=?").get(item.id) as {
      read_at: number | null;
    };
    expect(card.read_at).not.toBeNull();
    // trust_event 'promoted' recorded.
    expect(db.prepare("SELECT COUNT(*) AS n FROM trust_events").get()).toEqual({ n: 1 });
  });

  it("approvePromotion rejects when the inbox card is wrong kind", () => {
    const { db, h } = setup();
    const inbox = createInboxRepository(db);
    const item = inbox.create({
      companyId: "c1",
      kind: "approval",
      actorId: "a1",
      title: "x",
      preview: null,
      requiresAction: true,
      payloadJson: "{}",
    });
    expect(() => h.approvePromotion({ inboxItemId: item.id })).toThrow();
  });
});
```

Run: `pnpm --filter @prospero/main test "trust-handlers"`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the handler**

Create `apps/main/src/ipc/trust-handlers.ts`:

```typescript
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type TrustEvent, type TrustTier } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createTrustEventsRepository } from "../trust/repository.js";
import { tryGetRecorder } from "../activity/index.js";

export type TrustHandlersDeps = { db: Database.Database };

export type TrustHandlers = {
  getHistory(args: { agentId: string }): TrustEvent[];
  approvePromotion(args: { inboxItemId: string }): { ok: true };
};

export const trustHandlers = (deps: TrustHandlersDeps): TrustHandlers => {
  const trustRepo = createTrustEventsRepository(deps.db);
  const agentsRepo = createAgentsRepository(deps.db, tryGetRecorder() ?? null);
  const inboxRepo = createInboxRepository(deps.db);

  return {
    getHistory({ agentId }) {
      return trustRepo.listByAgent(agentId);
    },
    approvePromotion({ inboxItemId }) {
      const item = inboxRepo.getById?.(inboxItemId)
        ?? deps.db
          .prepare("SELECT * FROM inbox_items WHERE id = ?")
          .get(inboxItemId) as { id: string; kind: string; payload_json: string | null } | undefined;
      if (item === undefined) throw new Error(`inbox item ${inboxItemId} not found`);
      if (item.kind !== "trust_promotion_suggested") {
        throw new Error(`inbox item ${inboxItemId} is not a trust promotion suggestion`);
      }
      const payload = JSON.parse(item.payload_json ?? "{}") as {
        agentId: string;
        fromTier: TrustTier;
        toTier: TrustTier;
      };

      agentsRepo.setTrustTier(payload.agentId, payload.toTier);
      if (payload.toTier === "autonomo") {
        agentsRepo.setMode(payload.agentId, "auto");
      }

      trustRepo.create({
        agentId: payload.agentId,
        kind: "promoted",
        fromTier: payload.fromTier,
        toTier: payload.toTier,
        reason: "aprovado pelo usuário",
      });
      tryGetRecorder()?.recordActivity({
        companyId: agentsRepo.getById(payload.agentId)?.companyId ?? "",
        actor: { kind: "user", id: "user" },
        action: "trust.promoted",
        entityKind: "agent",
        entityId: payload.agentId,
        agentId: payload.agentId,
        payload: { fromTier: payload.fromTier, toTier: payload.toTier, reason: "aprovado pelo usuário" },
      });

      // Mark the inbox card resolved.
      deps.db
        .prepare("UPDATE inbox_items SET read_at = ? WHERE id = ?")
        .run(Date.now(), inboxItemId);

      return { ok: true };
    },
  };
};

export const registerTrustHandlers = (db: Database.Database): void => {
  const h = trustHandlers({ db });
  ipcMain.handle(IPC.TRUST_GET_HISTORY, (_e, args: { agentId: string }) =>
    h.getHistory(args),
  );
  ipcMain.handle(IPC.TRUST_APPROVE_PROMOTION, (_e, args: { inboxItemId: string }) =>
    h.approvePromotion(args),
  );
};
```

> **Adapt point:** Check whether `InboxRepository.getById` exists. If it does, use that; if not, the raw `SELECT * FROM inbox_items` fallback shown is fine.

- [ ] **Step 4: Run the handler test**

Run: `pnpm --filter @prospero/main test "trust-handlers"`
Expected: PASS — 3 cases.

- [ ] **Step 5: Register the handler**

In `apps/main/src/ipc/handlers.ts`, add the import and the registration call (after other `register*Handlers(db)` calls):

```typescript
import { registerTrustHandlers } from "./trust-handlers.js";
// ...inside registerIpcHandlers:
registerTrustHandlers(db);
```

- [ ] **Step 6: Expose on the preload bridge**

In `apps/main/src/ipc/preload.ts`, add the `trust` namespace (next to `security`):

```typescript
trust: {
  getHistory: (args: { agentId: string }) =>
    ipcRenderer.invoke(IPC.TRUST_GET_HISTORY, args) as Promise<TrustEvent[]>,
  approvePromotion: (args: { inboxItemId: string }) =>
    ipcRenderer.invoke(IPC.TRUST_APPROVE_PROMOTION, args) as Promise<{ ok: true }>,
},
```

Add `TrustEvent` to the type imports from `@prospero/shared`.

In `apps/renderer/src/env.d.ts`, mirror the namespace:

```typescript
trust: {
  getHistory: (args: { agentId: string }) => Promise<TrustEvent[]>;
  approvePromotion: (args: { inboxItemId: string }) => Promise<{ ok: true }>;
};
```

Add `TrustEvent` to the type imports at the top of that file.

- [ ] **Step 7: Run cross-package typechecks**

Run: `pnpm --filter @prospero/main typecheck`
Run: `pnpm --filter @prospero/renderer typecheck`
Expected: both clean.

- [ ] **Step 8: Update the IPC channel count test (if applicable)**

Run: `pnpm --filter @prospero/shared test ipc-channels`
Expected: PASS. If a count assertion fails, update the expected number to current + 2.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/trust-handlers.ts apps/main/tests/trust-handlers.test.ts apps/main/src/ipc/handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(trust): add trust:get-history and trust:approve-promotion ipc"
```

---

## Task 14: Full verification + non-regression

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo typecheck**

Run: `pnpm typecheck`
Expected: clean across all 4 packages.

- [ ] **Step 2: Whole-repo lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Whole-repo test**

Run: `pnpm test`
Expected: green. The PR-A baseline going in is 1564 + 2 todo. PR-A adds:
- Migration 0032 test: 2 cases
- Migration 0033 test: 3 cases
- agents/repository: +2 cases
- trust/repository: 2 cases
- trust/evaluate: 9 cases
- trust/track-record: 6 cases
- trust/read-only-tools: 19 cases
- trust/engine: 6 cases
- security.gate-trust: 6 cases
- verification/index: +1 case (Task 12 Step 2)
- trust-handlers: 3 cases

Expected delta: **+59 tests**, total ~**1623 passing + 2 todo**. Confirm and note the actual number for the next handoff.

- [ ] **Step 4: Token efficiency check**

Run:
```
grep -rn "trust_tier\|recomputeAgentTrust\|isReadOnlyTool\|evaluateTier" apps/main/src/orchestrator/
```
Expected: **zero matches**. PR-A is 100% gate + engine + IPC — not in any agent's prompt.

- [ ] **Step 5: Non-regression manual review**

- Confirm `agents.trust_tier` defaults to `novato` — a brand-new hire behaves exactly like before PR-A.
- Confirm the gate rule fires ONLY for non-novato + read-only — Write/Edit/Bash for confiavel/autonomo still go through the normal supervised path (unless `mode='auto'` separately enables them).
- Confirm the always-blocked list (M5 §8.3) still wins over trust auto-approve. (Already covered by Task 11 Step 1 test case 4.)
- Confirm `recomputeAgentTrust` is called from BOTH hooks (verification + approvals).
- M1–M13 intact — every prior security/inbox/activity test green.

- [ ] **Step 6: Optional cleanup commit (only if Step 1 or 2 surfaced fixes)**

If a count assertion or type literal needed touching:

```bash
git add -A
git commit -m "test(trust): update count assertions"
```

Otherwise skip — Task 14 is a checkpoint, not a code change.

---

## Self-Review (completed by plan author)

**Spec coverage (§4 + §11 row A of the spec):**

- §4.1 (3 degraus) → enforced via `evaluateTier` thresholds (Task 7) + `isReadOnlyTool` (Task 9) + autonomo↔mode coupling (Task 10) ✓
- §4.2 (`trust_tier` + `trust_events`) → Task 1 migration ✓
- §4.3 (`evaluateTier` pure + `TrackRecord` from existing tables) → Tasks 7 + 8 ✓
- §4.4 (gate rule + read-only classifier + audit) → Tasks 9 + 11 ✓
- §4.5 (Run Policy coupling — autonomo sets mode=auto on approval, demotion reverts to supervised) → Task 10 (demotion) + Task 13 (approval) ✓
- §4.6 (reactive engine, promotion/suggestion/demotion semantics) → Task 10 ✓
- §7 (migrations + tipos compartilhados, Zod NEVER in shared) → Tasks 1, 2, 3 ✓
- §8 (token efficiency: zero in prompts) → Task 14 Step 4 verifies ✓
- §9 (IPC `trust:get-history` + `trust:approve-promotion`) → Task 13 ✓
- §11 row A (full PR-A scope) → covered ✓
- §13 (security: rebaixamento imediato, autonomo passa por humano, gate só read-only, agente não auto-certifica, auditoria completa) → all enforced in Tasks 10 + 11 ✓

**Placeholder scan:** every code-changing step shows code. Adapt-points flagged explicitly: Task 8 Step 2 (verify column names against migrations 0007/0012/0027/0030), Task 10 Step 2 (verify `createAgentsRepository` signature), Task 12 Step 3 (locate the canonical approval-decision write — single line per implementer choice), Task 13 Step 3 (verify `InboxRepository.getById` exists or use raw SQL fallback). All four are "find this; mirror it", not "TBD".

**Type consistency:** `TrustTier` defined Task 3, used in Tasks 4/5/6/7/8/10/11/13. `TrackRecord` defined Task 3, used in Tasks 7/8/10. `TrustEvent` defined Task 3, used in Tasks 6/13. `evaluateTier` signature `(record, current) => TierEvaluation` consistent across Tasks 7 and 10. `recomputeAgentTrust(db, agentId, opts?)` signature consistent across Tasks 10 and 12. `setTrustTier(id, tier)` defined Task 4, used in Tasks 10 and 13. `isReadOnlyTool(toolName)` defined Task 9, used in Task 11.

**Token efficiency:** zero impact on any agent system prompt (Task 14 Step 4 verifies). The gate rule adds 2 SQL-free pure-function calls + one optional recorder call per FS-tool invocation by a non-novato agent — overhead is constant per call.

**Security:** the rule is purely additive — it can only auto-approve calls the path-fence + zone-check + always-blocked list have ALREADY accepted. Demotion is non-blocking; promotion to the dangerous tier (`autonomo`) is human-approved. Auto-approvals are audited.
