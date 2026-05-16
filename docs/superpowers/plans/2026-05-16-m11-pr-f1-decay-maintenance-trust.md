# M11 PR-F1 — Decay, Maintenance & Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the M11 memory system a self-maintaining hygiene loop — memories decay in importance over time, fading ones are flagged and dead ones are pruned, the user can up/down-vote skills and memories to steer trust, and low-trust entries drop out of the system prompt.

**Architecture:** A pure decay-math module (`decay.ts`) feeds a once-per-session maintenance pass (`maintenance.ts`) wired into app boot — it recomputes `memories.importance` from elapsed time, posts a `memory_review_needed` inbox notice when a memory enters the danger zone or is pruned, and soft-deletes the truly dead. Trust feedback flows from thumb up/down buttons in the Learning tab through new IPC handlers to atomic `bumpTrust` repo methods. `buildMemoryBlock` gains a `trust >= 0.2` filter so down-voted entries leave the L0 prompt budget.

**Tech Stack:** Electron 33 · React 18 · better-sqlite3 (WAL) · zod · Vitest · TypeScript (strict, `exactOptionalPropertyTypes`) · pnpm monorepo (`packages/shared`, `apps/main`, `apps/renderer`).

**Scope note:** PR-F was split into **F1 (this plan — decay/maintenance + trust)** and **F2 (Settings `user.md` editor + budget slider + nudges fallback + terminate-modal "promote skills" + docs)**. F2 closes M11. Consolidation prompts (spec §8) are folded into F2's nudges.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `apps/main/src/db/migrations/0022_inbox_memory_review_kind.sql` | Add `memory_review_needed` inbox kind | Create |
| `packages/shared/src/types/inbox.ts` | `InboxKind` union | Modify |
| `apps/renderer/src/routes/Inbox.tsx` | `KIND_BORDER` map | Modify |
| `apps/main/src/memory/decay.ts` | Pure decay math — `decayFactor`, `decayedImportance` | Create |
| `apps/main/src/memory/decay.test.ts` | Decay unit tests | Create |
| `apps/main/src/memory/memories-repository.ts` | Add `listDecayCandidates` + `bumpTrust` | Modify |
| `apps/main/src/memory/skills-repository.ts` | Add `bumpTrust` | Modify |
| `apps/main/src/memory/maintenance.ts` | Once-per-session decay/prune/warn pass | Create |
| `apps/main/src/memory/maintenance.test.ts` | Maintenance pass tests | Create |
| `apps/main/src/index.ts` | Wire maintenance into `app.whenReady` | Modify |
| `apps/main/src/orchestrator/system-prompt-memory.ts` | `trust >= 0.2` L0 filter | Modify |
| `apps/main/src/orchestrator/system-prompt-memory.test.ts` | L0 filter tests | Modify |
| `packages/shared/src/ipc-channels.ts` | `LEARNING_RATE_SKILL` / `LEARNING_RATE_MEMORY` channels | Modify |
| `packages/shared/tests/ipc-channels.test.ts` | Channel tests | Modify |
| `apps/main/src/ipc/learning-handlers.ts` | `rateSkill` / `rateMemory` handlers | Modify |
| `apps/main/tests/ipc.learning-handlers.test.ts` | Handler tests | Modify |
| `apps/main/src/ipc/preload.ts` | Preload bridge | Modify |
| `apps/renderer/src/env.d.ts` | Renderer typings | Modify |
| `apps/renderer/src/components/agent-panel/LearningPanel.tsx` | Thumb up/down UI | Modify |
| `apps/renderer/src/i18n/pt-BR.json` / `en-US.json` / `parity.test.ts` | i18n | Modify |

---

## Task 1: Inbox kind `memory_review_needed`

The maintenance pass posts a `memory_review_needed` inbox item when a memory fades or is pruned. SQLite cannot ALTER a CHECK constraint, so `inbox_items` is recreated — the same pattern as migrations `0019`/`0020`/`0021`.

**Files:**
- Create: `apps/main/src/db/migrations/0022_inbox_memory_review_kind.sql`
- Modify: `packages/shared/src/types/inbox.ts`
- Modify: `apps/renderer/src/routes/Inbox.tsx`

- [ ] **Step 1: Read the prior migration to copy the pattern exactly**

Read `apps/main/src/db/migrations/0021_inbox_goal_retrospective_kind.sql`. The new migration is identical except the CHECK list gains one kind.

- [ ] **Step 2: Create the migration**

Create `apps/main/src/db/migrations/0022_inbox_memory_review_kind.sql`:

```sql
-- M11 PR-F1: add the `memory_review_needed` inbox kind.
-- SQLite cannot ALTER a CHECK constraint, so `inbox_items` is recreated.

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
      'memory_review_needed'
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

> Compare the column list against the real `0021` file before saving. If `0021`'s `inbox_items` has any column this draft omits (or vice versa), match `0021` exactly and only add the one CHECK entry.

- [ ] **Step 3: Add the kind to the shared type**

In `packages/shared/src/types/inbox.ts`, add `| "memory_review_needed"` as the last member of the `InboxKind` union.

- [ ] **Step 4: Add the renderer kind mapping**

In `apps/renderer/src/routes/Inbox.tsx`, add to the `KIND_BORDER` record (it is typed `Record<InboxKind, string>`, so omitting the new key is a typecheck error):

```typescript
  memory_review_needed: "border-l-4 border-l-brand",
```

> Do NOT add `memory_review_needed` to `GOAL_KINDS` — it is not a goal kind. Read the file: if there are other `Record<InboxKind, ...>` maps besides `KIND_BORDER`, add the key to each. If `FILTERS` is a plain `InboxKind[]` (not exhaustive), leave it unchanged — the prior skill/goal kinds were also left out of `FILTERS`.

- [ ] **Step 5: Write a migration test**

Read `apps/main/src/db/migrations.test.ts` (or the existing migration test file — find it with the test that covers `0021`). Append a test mirroring the `0021` test:

```typescript
it("0022 allows the memory_review_needed inbox kind and preserves prior kinds", () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  // new kind accepted
  db.prepare(
    `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
     VALUES ('ib1','c1','memory_review_needed','Memory fading',0,0)`,
  ).run();
  // a prior kind still accepted
  db.prepare(
    `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
     VALUES ('ib2','c1','goal_retrospective_ready','Retro',0,0)`,
  ).run();
  const n = (db.prepare("SELECT COUNT(*) AS n FROM inbox_items").get() as { n: number }).n;
  expect(n).toBe(2);
});
```

> Match the existing migration-test file's imports and helper style (the `0021` test is the template). If that file builds `inbox_items` rows with a different column set, copy its exact INSERT shape.

- [ ] **Step 6: Run the migration test**

Run: `pnpm --filter @prospero/main exec vitest run src/db/migrations.test.ts`
Expected: PASS (find the real test filename in Step 5 and use it here).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add apps/main/src/db/migrations/0022_inbox_memory_review_kind.sql packages/shared/src/types/inbox.ts apps/renderer/src/routes/Inbox.tsx apps/main/src/db/migrations.test.ts
git commit -m "feat(m11): add the memory_review_needed inbox kind"
```

---

## Task 2: Decay math — pure functions

A pure, isolated module so the decay curve is unit-tested without a database. Decay has a 90-day half-life; frequent access (the memory's `access_count`) stretches that half-life so well-used memories fade slower.

**Files:**
- Create: `apps/main/src/memory/decay.ts`
- Create: `apps/main/src/memory/decay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/memory/decay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { decayFactor, decayedImportance } from "./decay.js";

describe("decayFactor", () => {
  it("is 1 when no time has elapsed", () => {
    expect(decayFactor(0, 0)).toBe(1);
  });

  it("is 1 for negative elapsed time (clock skew guard)", () => {
    expect(decayFactor(-5, 0)).toBe(1);
  });

  it("halves importance after one 90-day half-life with no access boost", () => {
    expect(decayFactor(90, 0)).toBeCloseTo(0.5, 5);
  });

  it("decays slower when the memory has been accessed often", () => {
    const cold = decayFactor(90, 0);
    const hot = decayFactor(90, 20);
    expect(hot).toBeGreaterThan(cold);
  });

  it("caps the access boost so it cannot stop decay entirely", () => {
    // accessCount above the cap behaves the same as at the cap
    expect(decayFactor(90, 1000)).toBeCloseTo(decayFactor(90, 20), 5);
  });
});

describe("decayedImportance", () => {
  it("never returns a value above the input importance", () => {
    expect(decayedImportance(0.8, 0, 90)).toBeLessThan(0.8);
  });

  it("never returns a negative value", () => {
    expect(decayedImportance(0.8, 0, 100000)).toBeGreaterThanOrEqual(0);
  });

  it("leaves importance untouched when no time elapsed", () => {
    expect(decayedImportance(0.5, 3, 0)).toBe(0.5);
  });

  it("clamps the result to at most 1", () => {
    expect(decayedImportance(1.5, 0, 0)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/decay.test.ts`
Expected: FAIL — `Cannot find module './decay.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/main/src/memory/decay.ts`:

```typescript
// M11 PR-F1: decay math for memory importance.
//
// Memory importance fades on a 90-day half-life. The maintenance pass
// (maintenance.ts) calls these once per session with the real elapsed time
// since the previous pass, so the total decay over 90 calendar days is 0.5
// regardless of how many times the app was opened.

// Days for importance to halve with no access boost.
const HALF_LIFE_DAYS = 90;
// access_count is clamped here before it stretches the half-life — a memory
// accessed 20+ times gets a 3x longer half-life, and no more.
const ACCESS_CAP = 20;
const ACCESS_BOOST_PER_HIT = 0.1;

// Multiplicative decay applied to importance for `elapsedDays` of real time.
// Returns a value in (0, 1]. accessCount stretches the half-life so well-used
// memories fade slower.
export const decayFactor = (elapsedDays: number, accessCount: number): number => {
  if (elapsedDays <= 0) return 1;
  const boost = 1 + Math.min(Math.max(accessCount, 0), ACCESS_CAP) * ACCESS_BOOST_PER_HIT;
  return Math.pow(0.5, elapsedDays / (HALF_LIFE_DAYS * boost));
};

// The new importance after `elapsedDays`, clamped to [0, 1].
export const decayedImportance = (
  importance: number,
  accessCount: number,
  elapsedDays: number,
): number => {
  const next = importance * decayFactor(elapsedDays, accessCount);
  return Math.max(0, Math.min(1, next));
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/decay.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/memory/decay.ts apps/main/src/memory/decay.test.ts
git commit -m "feat(m11): add the memory importance decay math"
```

---

## Task 3: Repository support — `listDecayCandidates` + `bumpTrust`

The maintenance pass needs to enumerate every decayable memory; trust feedback needs an atomic clamp-on-write. Two new methods on `memories-repository`, one on `skills-repository`.

**Files:**
- Modify: `apps/main/src/memory/memories-repository.ts`
- Modify: `apps/main/src/memory/memories-repository.test.ts`
- Modify: `apps/main/src/memory/skills-repository.ts`
- Modify: `apps/main/src/memory/skills-repository.test.ts`

- [ ] **Step 1: Read both repository files**

Read `apps/main/src/memory/memories-repository.ts` and `skills-repository.ts` in full. Note: the exact `MemoriesRepository` / `SkillsRepository` type definitions, the `rowToMemory` / `rowToSkill` mapping helpers, how `update` is implemented, and the prepared-statement style. The new methods must match that style exactly.

- [ ] **Step 2: Write the failing repository tests**

In `apps/main/src/memory/memories-repository.test.ts`, append (match the file's existing `seed()` / db-setup helper — read it first):

```typescript
describe("memories-repository — decay support", () => {
  it("listDecayCandidates returns active, non-pinned, non-identity memories across companies", () => {
    const db = seed();
    const repo = createMemoriesRepository(db);
    const keep = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "decays" });
    repo.create({ companyId: "c1", agentId: null, kind: "identity", body: "exempt" });
    const pinned = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "pinned" });
    repo.update(pinned.id, { pinned: true });
    const deleted = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "gone" });
    repo.softDelete(deleted.id);

    const ids = repo.listDecayCandidates().map((m) => m.id);
    expect(ids).toEqual([keep.id]);
  });

  it("bumpTrust clamps the result to [0, 1]", () => {
    const db = seed();
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "x" });
    // default trust is 0.5
    expect(repo.bumpTrust(m.id, -0.1).trust).toBeCloseTo(0.4, 5);
    expect(repo.bumpTrust(m.id, -1).trust).toBe(0);
    expect(repo.bumpTrust(m.id, 5).trust).toBe(1);
  });
});
```

In `apps/main/src/memory/skills-repository.test.ts`, append (match its `seed()` helper and the real `create` signature — read it first; `create` needs `companyId, agentId, name, bodyPath, description, source`):

```typescript
describe("skills-repository — trust feedback", () => {
  it("bumpTrust clamps the result to [0, 1]", () => {
    const db = seed();
    const repo = createSkillsRepository(db);
    const s = repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    // default trust is 0.5
    expect(repo.bumpTrust(s.id, 0.05).trust).toBeCloseTo(0.55, 5);
    expect(repo.bumpTrust(s.id, 5).trust).toBe(1);
    expect(repo.bumpTrust(s.id, -10).trust).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/memories-repository.test.ts src/memory/skills-repository.test.ts`
Expected: FAIL — `listDecayCandidates` / `bumpTrust` are not functions.

- [ ] **Step 4: Implement on `memories-repository.ts`**

Add to the `MemoriesRepository` type (after `search`):

```typescript
  // M11 PR-F1: active, non-pinned, non-identity memories — the decay pass input.
  listDecayCandidates(): Memory[];
  // M11 PR-F1: atomically add `delta` to trust, clamped to [0, 1].
  bumpTrust(id: string, delta: number): Memory;
```

Add the prepared statements alongside the others and the two methods to the returned object. Use the file's existing `rowToMemory` helper and `getById`:

```typescript
  const listDecayCandidatesStmt = db.prepare(
    `SELECT * FROM memories
      WHERE soft_deleted = 0 AND pinned = 0 AND kind != 'identity'
      ORDER BY created_at ASC`,
  );
  const bumpTrustStmt = db.prepare(
    "UPDATE memories SET trust = MAX(0, MIN(1, trust + ?)) WHERE id = ?",
  );
```

```typescript
    listDecayCandidates() {
      return (listDecayCandidatesStmt.all() as MemoryRow[]).map(rowToMemory);
    },
    bumpTrust(id, delta) {
      bumpTrustStmt.run(delta, id);
      const updated = getById(id);
      if (updated === null) throw new Error(`memory ${id} not found`);
      return updated;
    },
```

> Use the row type name the file already uses (`MemoryRow` or similar) and the file's existing `getById` (it may be a closure or a method on the object — call it the way other methods in the file do). If `update` already exposes a private `getById`, reuse it.

- [ ] **Step 5: Implement on `skills-repository.ts`**

Add to the `SkillsRepository` type (after `recordUse`):

```typescript
  // M11 PR-F1: atomically add `delta` to trust, clamped to [0, 1].
  bumpTrust(id: string, delta: number): Skill;
```

Add the statement and method, matching the memories implementation:

```typescript
  const bumpTrustStmt = db.prepare(
    "UPDATE skills SET trust = MAX(0, MIN(1, trust + ?)) WHERE id = ?",
  );
```

```typescript
    bumpTrust(id, delta) {
      bumpTrustStmt.run(delta, id);
      const updated = getById(id);
      if (updated === null) throw new Error(`skill ${id} not found`);
      return updated;
    },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/memories-repository.test.ts src/memory/skills-repository.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add apps/main/src/memory/memories-repository.ts apps/main/src/memory/memories-repository.test.ts apps/main/src/memory/skills-repository.ts apps/main/src/memory/skills-repository.test.ts
git commit -m "feat(m11): add decay-candidate listing and trust bumping to the memory repos"
```

---

## Task 4: The maintenance pass

A once-per-session function that decays every candidate memory, posts a `memory_review_needed` notice when one enters the danger zone or is pruned, and soft-deletes the truly dead. A 20-hour guard (stored in the `settings` key-value table) keeps it from running on every relaunch.

**Files:**
- Create: `apps/main/src/memory/maintenance.ts`
- Create: `apps/main/src/memory/maintenance.test.ts`

- [ ] **Step 1: Confirm the `settings` table shape**

Read `apps/main/src/db/post-migrations/0006.ts` (or any post-migration) — it reads/writes the key-value `settings` table via `SELECT value FROM settings WHERE key = ?` and `INSERT INTO settings (key, value) VALUES (?, ?)`. Confirm the table is `settings(key TEXT PRIMARY KEY, value TEXT)` by reading migration `0001` (the `settings` CREATE TABLE). The maintenance module uses the same table with key `memory_maintenance_last_run`.

- [ ] **Step 2: Write the failing test**

Create `apps/main/src/memory/maintenance.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createMemoriesRepository } from "./memories-repository.js";
import { runMemoryMaintenance } from "./maintenance.js";

const DAY = 24 * 60 * 60 * 1000;

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

const setLastRun = (db: Database.Database, ms: number): void => {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('memory_maintenance_last_run', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(ms));
};

describe("runMemoryMaintenance", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
  });

  it("does not decay on the very first run — it only records the baseline", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "x" });
    const result = runMemoryMaintenance(db, 100 * DAY);
    expect(result.ran).toBe(true);
    expect(result.decayed).toBe(0);
    expect(repo.getById(m.id)?.importance).toBe(0.5);
  });

  it("skips the run when the last pass was under 20 hours ago", () => {
    setLastRun(db, 100 * DAY);
    const result = runMemoryMaintenance(db, 100 * DAY + 60 * 60 * 1000);
    expect(result.ran).toBe(false);
  });

  it("decays importance by the elapsed time since the last run", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "x" });
    setLastRun(db, 0);
    runMemoryMaintenance(db, 90 * DAY); // one 90-day half-life
    expect(repo.getById(m.id)?.importance).toBeCloseTo(0.25, 2); // 0.5 -> halved
  });

  it("does not decay pinned or identity memories", () => {
    const repo = createMemoriesRepository(db);
    const pinned = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "p" });
    repo.update(pinned.id, { pinned: true });
    const identity = repo.create({ companyId: "c1", agentId: null, kind: "identity", body: "i" });
    setLastRun(db, 0);
    runMemoryMaintenance(db, 900 * DAY);
    expect(repo.getById(pinned.id)?.importance).toBe(0.5);
    expect(repo.getById(identity.id)?.importance).toBe(0.5);
  });

  it("posts a memory_review_needed notice when a memory crosses into the danger zone", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "fading note" });
    repo.update(m.id, { importance: 0.3 });
    setLastRun(db, 0);
    // 90 days -> 0.3 * 0.5 = 0.15, which is below the 0.2 warn line but above 0.1
    const result = runMemoryMaintenance(db, 90 * DAY);
    expect(result.warned).toBe(1);
    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE company_id = 'c1'")
      .all() as Array<{ kind: string }>;
    expect(inbox).toEqual([{ kind: "memory_review_needed" }]);
  });

  it("prunes a memory whose decayed importance is below 0.1 and is stale", () => {
    const repo = createMemoriesRepository(db);
    const m = repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "dead" });
    repo.update(m.id, { importance: 0.12 });
    setLastRun(db, 0);
    // created_at is 90*DAY old here, well past the 30-day stale line;
    // 0.12 * 0.5 = 0.06 -> below 0.1 -> pruned
    const result = runMemoryMaintenance(db, 90 * DAY);
    expect(result.pruned).toBe(1);
    expect(repo.getById(m.id)).toBeNull(); // soft-deleted, excluded from getById
    const n = (db.prepare("SELECT COUNT(*) AS n FROM inbox_items").get() as { n: number }).n;
    expect(n).toBe(1); // one notice for the prune
  });
});
```

> `repo.getById` must return `null` for a soft-deleted row. Read `memories-repository.ts` to confirm `getById` filters `soft_deleted = 0`. If it does NOT, change the prune assertion to query `soft_deleted` directly: `db.prepare("SELECT soft_deleted FROM memories WHERE id = ?").get(m.id)`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/maintenance.test.ts`
Expected: FAIL — `Cannot find module './maintenance.js'`.

- [ ] **Step 4: Implement the maintenance pass**

Create `apps/main/src/memory/maintenance.ts`:

```typescript
import type Database from "better-sqlite3";
import { createMemoriesRepository } from "./memories-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { decayedImportance } from "./decay.js";

// M11 PR-F1: the once-per-session memory hygiene pass.
//
// Each pass recomputes `memories.importance` from the real time elapsed since
// the previous pass, posts a `memory_review_needed` inbox notice when a memory
// fades into the danger zone or is pruned, and soft-deletes memories that are
// both unimportant and stale. Pinned and `identity` memories are exempt
// (excluded by memoriesRepo.listDecayCandidates).

const DAY_MS = 24 * 60 * 60 * 1000;
// The pass runs at most once per ~day even if the app is relaunched often.
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
// Importance below this AND staleness past STALE_DAYS => prune.
const PRUNE_IMPORTANCE = 0.1;
// Importance dropping below this (without being pruned) => one-time warning.
const WARN_IMPORTANCE = 0.2;
// A memory is "stale" when it has not been touched in this many days.
const STALE_DAYS = 30;
// The settings key holding the last pass's wall-clock time (ms, as a string).
const LAST_RUN_KEY = "memory_maintenance_last_run";

export type MaintenanceResult = {
  ran: boolean;
  decayed: number;
  warned: number;
  pruned: number;
};

const readLastRun = (db: Database.Database): number | null => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(LAST_RUN_KEY) as
    | { value: string }
    | undefined;
  if (row === undefined) return null;
  const ms = Number(row.value);
  return Number.isFinite(ms) ? ms : null;
};

const writeLastRun = (db: Database.Database, now: number): void => {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(LAST_RUN_KEY, String(now));
};

// Runs the decay/prune/warn pass. `now` is injected for testability.
export const runMemoryMaintenance = (db: Database.Database, now: number): MaintenanceResult => {
  const lastRun = readLastRun(db);

  // Throttle: at most one pass per ~day.
  if (lastRun !== null && now - lastRun < MIN_INTERVAL_MS) {
    return { ran: false, decayed: 0, warned: 0, pruned: 0 };
  }

  // First-ever run: record the baseline, decay nothing (elapsed is unknown).
  if (lastRun === null) {
    writeLastRun(db, now);
    return { ran: true, decayed: 0, warned: 0, pruned: 0 };
  }

  const elapsedDays = (now - lastRun) / DAY_MS;
  const memoriesRepo = createMemoriesRepository(db);
  const inboxRepo = createInboxRepository(db);

  let decayed = 0;
  let warned = 0;
  let pruned = 0;

  for (const m of memoriesRepo.listDecayCandidates()) {
    const before = m.importance;
    const after = decayedImportance(before, m.accessCount, elapsedDays);
    memoriesRepo.update(m.id, { importance: after });
    decayed += 1;

    const lastTouched = m.lastAccessed ?? m.createdAt;
    const stale = now - lastTouched > STALE_DAYS * DAY_MS;

    if (after < PRUNE_IMPORTANCE && stale) {
      memoriesRepo.softDelete(m.id);
      inboxRepo.create({
        companyId: m.companyId,
        kind: "memory_review_needed",
        title: "Memory pruned",
        preview: m.body.slice(0, 200),
        requiresAction: false,
        payloadJson: JSON.stringify({ memoryId: m.id, reason: "pruned" }),
      });
      pruned += 1;
    } else if (before >= WARN_IMPORTANCE && after < WARN_IMPORTANCE) {
      inboxRepo.create({
        companyId: m.companyId,
        kind: "memory_review_needed",
        title: "Memory fading",
        preview: m.body.slice(0, 200),
        requiresAction: false,
        payloadJson: JSON.stringify({ memoryId: m.id, reason: "fading" }),
      });
      warned += 1;
    }
  }

  writeLastRun(db, now);
  return { ran: true, decayed, warned, pruned };
};
```

> Verify the `createInboxRepository(db).create({...})` argument shape against `apps/main/src/inbox/repository.ts` — it is the same call the derivation worker uses (`apps/main/src/derivation/worker.ts` posts `goal_retrospective_ready`). Match its exact field names (`companyId`, `kind`, `title`, `preview`, `requiresAction`, `payloadJson`, and `actorId` if required). If `actorId` is required (not optional), pass `actorId: null`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/maintenance.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add apps/main/src/memory/maintenance.ts apps/main/src/memory/maintenance.test.ts
git commit -m "feat(m11): add the once-per-session memory maintenance pass"
```

---

## Task 5: Wire maintenance into app boot

The maintenance pass runs once when the main process finishes booting.

**Files:**
- Modify: `apps/main/src/index.ts`

- [ ] **Step 1: Read the boot sequence**

Read `apps/main/src/index.ts` — specifically the `app.whenReady().then(() => { ... })` block. Note where `db` is opened (`openDatabase(...)`) and where `registerIpcHandlers(db)` is called. The maintenance pass runs after the DB is open and IPC is registered, before window creation.

- [ ] **Step 2: Add the import**

Add alongside the other `apps/main/src/...` imports at the top of `index.ts`:

```typescript
import { runMemoryMaintenance } from "./memory/maintenance.js";
```

- [ ] **Step 3: Call the pass during boot**

In the `app.whenReady().then(...)` body, immediately after `registerIpcHandlers(db);`, add:

```typescript
  // M11 PR-F1: decay/prune the memory store once per session.
  try {
    const maintenance = runMemoryMaintenance(db, Date.now());
    if (maintenance.ran) {
      console.warn(
        `[memory] maintenance: decayed ${maintenance.decayed}, ` +
          `warned ${maintenance.warned}, pruned ${maintenance.pruned}`,
      );
    }
  } catch (err) {
    console.warn(`[memory] maintenance pass failed: ${String(err)}`);
  }
```

> The `try/catch` is deliberate — a maintenance failure must never block app boot. Match the surrounding code's logging style: if `index.ts` uses a `log()` helper instead of `console.warn`, use that.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Verify the main test suite still passes**

Run: `pnpm --filter @prospero/main exec vitest run`
Expected: PASS — no regressions (`index.ts` has no direct unit test; this confirms nothing it imports broke).

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/index.ts
git commit -m "feat(m11): run the memory maintenance pass on app boot"
```

---

## Task 6: L0 trust filter in `buildMemoryBlock`

Down-voted skills and memories (`trust < 0.2`) drop out of the system-prompt L0 budget — they are still readable on-demand via `skill_read` / `memory_search`, just no longer auto-injected (spec §6, §8).

**Files:**
- Modify: `apps/main/src/orchestrator/system-prompt-memory.ts`
- Modify: `apps/main/src/orchestrator/system-prompt-memory.test.ts`

- [ ] **Step 1: Read the current implementation and test**

Read `apps/main/src/orchestrator/system-prompt-memory.ts` (the `renderMemories` and `renderSkills` helpers, lines ~23–45) and `system-prompt-memory.test.ts`. Note the `Memory` / `Skill` imports and the existing test style.

- [ ] **Step 2: Write the failing test**

In `apps/main/src/orchestrator/system-prompt-memory.test.ts`, append a test inside the existing top-level `describe`. Match the file's existing fixture helpers — read how it builds `Memory` / `Skill` rows and a `buildMemoryBlock` deps object (it likely uses in-memory repos or a fake). Use the same construction:

```typescript
it("excludes skills and memories with trust below 0.2 from the L0 block", () => {
  // Build deps with one trusted and one distrusted skill + memory.
  // (Use the same repo/deps setup the other tests in this file use.)
  const block = buildMemoryBlock(deps);
  expect(block).toContain("trusted-skill");
  expect(block).not.toContain("distrusted-skill");
  expect(block).toContain("trusted memory body");
  expect(block).not.toContain("distrusted memory body");
});
```

> Concretely: seed one skill `name: "trusted-skill", trust: 0.5` and one `name: "distrusted-skill", trust: 0.1`; one memory `body: "trusted memory body", trust: 0.5` and one `body: "distrusted memory body", trust: 0.1`. Reuse whatever repo-seeding helper the existing tests use (the file already builds `buildMemoryBlock` deps — copy that exact setup). If the existing tests use real in-memory repos, `create` the rows then `bumpTrust`/`update` to set the distrusted trust to 0.1.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/system-prompt-memory.test.ts`
Expected: FAIL — distrusted entries are still in the block.

- [ ] **Step 4: Add the trust filter**

In `apps/main/src/orchestrator/system-prompt-memory.ts`, add the constant near the caps:

```typescript
// M11 PR-F1: entries below this trust drop out of the L0 prompt budget.
// They remain reachable on-demand via skill_read / memory_search.
const MIN_L0_TRUST = 0.2;
```

In `renderMemories`, filter before the loop:

```typescript
const renderMemories = (rows: Memory[], cap: number): string => {
  let out = "";
  for (const m of rows) {
    if (m.trust < MIN_L0_TRUST) continue;
    const line = `- ${m.body.trim()}\n`;
    if (out.length + line.length > cap) break;
    out += line;
  }
  return out;
};
```

In `renderSkills`, filter inside or before the existing sort:

```typescript
const renderSkills = (skills: Skill[], cap: number): string => {
  const sorted = [...skills]
    .filter((s) => s.trust >= MIN_L0_TRUST)
    .sort((a, b) => b.useCount - a.useCount || b.trust - a.trust || a.name.localeCompare(b.name));
  let out = "";
  for (const s of sorted) {
    const line = `- ${s.name}: ${s.description.trim()}\n`;
    if (out.length + line.length > cap) break;
    out += line;
  }
  return out;
};
```

> Match the real current bodies of these helpers (read them in Step 1) — only add the `filter` / `continue`. Do not restructure the rest.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/system-prompt-memory.test.ts`
Expected: PASS — including all pre-existing tests.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add apps/main/src/orchestrator/system-prompt-memory.ts apps/main/src/orchestrator/system-prompt-memory.test.ts
git commit -m "feat(m11): drop low-trust entries from the l0 memory block"
```

---

## Task 7: Trust feedback IPC — `rateSkill` / `rateMemory`

Two read-write IPC handlers wire the thumb up/down UI to `bumpTrust`. Up = `+0.05`, down = `−0.10` (asymmetric — distrust accrues faster than trust, per spec §8).

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/tests/ipc-channels.test.ts`
- Modify: `apps/main/src/ipc/learning-handlers.ts`
- Modify: `apps/main/tests/ipc.learning-handlers.test.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Add the channels + test**

In `packages/shared/src/ipc-channels.ts`, add inside the `IPC` object before `} as const;`:

```typescript
  LEARNING_RATE_SKILL: "learning:rate-skill",
  LEARNING_RATE_MEMORY: "learning:rate-memory",
```

In `packages/shared/tests/ipc-channels.test.ts`, add inside `describe("IPC channels", ...)`:

```typescript
  it("exposes the M11 trust-feedback channels", () => {
    expect(IPC.LEARNING_RATE_SKILL).toBe("learning:rate-skill");
    expect(IPC.LEARNING_RATE_MEMORY).toBe("learning:rate-memory");
  });
```

> `ipc-channels.test.ts` uses a uniqueness test (`new Set(...).size`), not a fixed channel count — no count to bump. Confirm by reading the file.

- [ ] **Step 2: Write the failing handler test**

In `apps/main/tests/ipc.learning-handlers.test.ts`, append (the file already imports `createSkillsRepository` and `createMemoriesRepository` and has a `seed()` + `USERDATA` const — verify and reuse):

```typescript
describe("learningHandlers — trust feedback", () => {
  it("rateSkill up nudges trust by +0.05, down by -0.10", () => {
    const db = seed();
    const skill = createSkillsRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      name: "s",
      bodyPath: "p",
      description: "d",
      source: "user_authored",
    });
    const h = learningHandlers(db, USERDATA);
    expect(h.rateSkill({ skillId: skill.id, direction: "up" }).trust).toBeCloseTo(0.55, 5);
    expect(h.rateSkill({ skillId: skill.id, direction: "down" }).trust).toBeCloseTo(0.45, 5);
  });

  it("rateMemory up nudges trust by +0.05, down by -0.10", () => {
    const db = seed();
    const memory = createMemoriesRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      kind: "preference",
      body: "b",
    });
    const h = learningHandlers(db, USERDATA);
    expect(h.rateMemory({ memoryId: memory.id, direction: "up" }).trust).toBeCloseTo(0.55, 5);
    expect(h.rateMemory({ memoryId: memory.id, direction: "down" }).trust).toBeCloseTo(0.45, 5);
  });
});
```

> Confirm the handler factory's name (`learningHandlers`) and how the existing tests call it (`learningHandlers(db, USERDATA)` vs `.orgLearnings(...)` chained). Match exactly. Confirm the `createMemoriesRepository().create` signature accepts the fields above — read the repo if unsure.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: FAIL — `rateSkill` / `rateMemory` are not functions.

- [ ] **Step 4: Add the handlers**

In `apps/main/src/ipc/learning-handlers.ts`:

- Add a shared `RateDirection` type near the top of the file (after the imports):

```typescript
// M11 PR-F1: a thumb up/down on a skill or memory.
type RateDirection = "up" | "down";
// Asymmetric, per spec §8: distrust accrues faster than trust.
const TRUST_DELTA: Record<RateDirection, number> = { up: 0.05, down: -0.1 };
```

- Add to the `LearningHandlers` type (after `orgLearnings`):

```typescript
  // M11 PR-F1: user thumb up/down on a skill / memory — steers L0 trust.
  rateSkill(args: { skillId: string; direction: RateDirection }): Skill;
  rateMemory(args: { memoryId: string; direction: RateDirection }): Memory;
```

- Add the methods to the returned object (after `orgLearnings`):

```typescript
    rateSkill({ skillId, direction }) {
      return createSkillsRepository(db).bumpTrust(skillId, TRUST_DELTA[direction]);
    },
    rateMemory({ memoryId, direction }) {
      return createMemoriesRepository(db).bumpTrust(memoryId, TRUST_DELTA[direction]);
    },
```

- In `registerLearningHandlers`, register after the `LEARNING_ORG` handler:

```typescript
  ipcMain.handle(IPC.LEARNING_RATE_SKILL, (_e, args: { skillId: string; direction: RateDirection }) =>
    h.rateSkill(args),
  );
  ipcMain.handle(
    IPC.LEARNING_RATE_MEMORY,
    (_e, args: { memoryId: string; direction: RateDirection }) => h.rateMemory(args),
  );
```

> `Skill` and `Memory` are already imported in `learning-handlers.ts` (used by `orgLearnings`) — verify; if not, add them to the `@prospero/shared` import. `createSkillsRepository` / `createMemoriesRepository` are already imported.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts` → PASS
Run: `pnpm --filter @prospero/shared test` → PASS

- [ ] **Step 6: Add the preload bridge + `env.d.ts`**

In `apps/main/src/ipc/preload.ts`, inside the `learning: { ... }` namespace (after `orgLearnings`):

```typescript
    rateSkill: (skillId: string, direction: "up" | "down") =>
      ipcRenderer.invoke(IPC.LEARNING_RATE_SKILL, { skillId, direction }) as Promise<Skill>,
    rateMemory: (memoryId: string, direction: "up" | "down") =>
      ipcRenderer.invoke(IPC.LEARNING_RATE_MEMORY, { memoryId, direction }) as Promise<Memory>,
```

In `apps/renderer/src/env.d.ts`, inside the `learning: { ... }` interface (after `orgLearnings`):

```typescript
        rateSkill: (skillId: string, direction: "up" | "down") => Promise<Skill>;
        rateMemory: (memoryId: string, direction: "up" | "down") => Promise<Memory>;
```

> `Skill` / `Memory` are already imported in both files (used by `orgLearnings`) — verify.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck` → PASS

```bash
git add packages/shared/src/ipc-channels.ts packages/shared/tests/ipc-channels.test.ts apps/main/src/ipc/learning-handlers.ts apps/main/tests/ipc.learning-handlers.test.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m11): add the skill and memory trust-feedback ipc handlers"
```

---

## Task 8: Thumb up/down UI in the Learning tab

The Skills and Memory sub-tabs of the Learning panel get a 👍 / 👎 control per row; clicking calls the rate IPC and refreshes the row's trust.

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/LearningPanel.tsx`
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 1: Add the parity check (failing test first)**

In `apps/renderer/src/i18n/parity.test.ts`, add at the end of the `describe("i18n parity", ...)` block (match the file's existing helper names — `flatten`, `ptBR`, `enUS`):

```typescript
  it("includes the M11 PR-F trust-feedback keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of ["learning.rateUp", "learning.rateDown"]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: FAIL — keys missing.

- [ ] **Step 3: Add the i18n keys**

In `apps/renderer/src/i18n/pt-BR.json`, find the `learning` object and add (mind the trailing comma, match indentation):

```json
  "rateUp": "Marcar como útil",
  "rateDown": "Marcar como pouco útil"
```

In `apps/renderer/src/i18n/en-US.json`, mirror inside `learning`:

```json
  "rateUp": "Mark as useful",
  "rateDown": "Mark as not useful"
```

> If there is no `learning` object in the i18n files, the Learning panel currently uses keys from a different namespace — read `LearningPanel.tsx` to find which `t("...")` prefix it uses and place `rateUp`/`rateDown` under that same namespace, updating the parity-test keys to match.

- [ ] **Step 4: Run the parity test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Read `LearningPanel.tsx` and add the rating control**

Read `apps/renderer/src/components/agent-panel/LearningPanel.tsx` in full. Note: the `Props` (`agentId`, `skills`, `memories`), how the Skills sub-tab renders each `skill` row (the trust badge `Math.round(skill.trust * 100)%`), how the Memory sub-tab renders each `memory` row, and whether the panel keeps local state or relies on the parent for `skills`/`memories`.

Add local trust-override state so a click reflects immediately without a full parent refetch. Near the top of the component:

```tsx
  // M11 PR-F1: local trust overrides so a thumb click updates the row at once.
  const [skillTrust, setSkillTrust] = useState<Record<string, number>>({});
  const [memoryTrust, setMemoryTrust] = useState<Record<string, number>>({});

  const rateSkill = (skillId: string, direction: "up" | "down"): void => {
    void window.prospero.learning.rateSkill(skillId, direction).then((s) => {
      setSkillTrust((prev) => ({ ...prev, [skillId]: s.trust }));
    });
  };
  const rateMemory = (memoryId: string, direction: "up" | "down"): void => {
    void window.prospero.learning.rateMemory(memoryId, direction).then((m) => {
      setMemoryTrust((prev) => ({ ...prev, [memoryId]: m.trust }));
    });
  };
```

> Ensure `useState` is in the React import at the top of the file.

In the Skills sub-tab row, where the trust badge renders, use the override when present and add the buttons:

```tsx
  {/* trust badge — use the local override when the row was just rated */}
  <span>{Math.round((skillTrust[skill.id] ?? skill.trust) * 100)}%</span>
  <button
    type="button"
    title={t("learning.rateUp")}
    aria-label={t("learning.rateUp")}
    onClick={() => rateSkill(skill.id, "up")}
    className="text-ink-soft hover:text-semantic-success"
  >
    👍
  </button>
  <button
    type="button"
    title={t("learning.rateDown")}
    aria-label={t("learning.rateDown")}
    onClick={() => rateSkill(skill.id, "down")}
    className="text-ink-soft hover:text-semantic-danger"
  >
    👎
  </button>
```

In the Memory sub-tab row, add the equivalent for memories (memories render a `kind` badge and body — add the same two buttons calling `rateMemory(memory.id, ...)`; show the trust override if you also surface a memory trust badge — if the memory row currently shows no trust number, just add the two buttons):

```tsx
  <button
    type="button"
    title={t("learning.rateUp")}
    aria-label={t("learning.rateUp")}
    onClick={() => rateMemory(memory.id, "up")}
    className="text-ink-soft hover:text-semantic-success"
  >
    👍
  </button>
  <button
    type="button"
    title={t("learning.rateDown")}
    aria-label={t("learning.rateDown")}
    onClick={() => rateMemory(memory.id, "down")}
    className="text-ink-soft hover:text-semantic-danger"
  >
    👎
  </button>
```

> Match the real markup and Tailwind classes of the surrounding rows. The CSS classes above (`text-ink-soft`, `hover:text-semantic-success`, `hover:text-semantic-danger`) follow the conventions seen elsewhere — verify they exist in the codebase; if a row uses different muted/semantic class names, use those. Keep the buttons inline with the existing badge/action area. The `t` function and `useTranslation` are already in this component (it renders translated sub-tab labels) — verify.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck` → PASS
Run: `pnpm lint` → PASS

- [ ] **Step 7: Full verification**

Run: `pnpm test`
Expected: PASS — all prior tests plus the new migration, decay, maintenance, repo, system-prompt, IPC, channel, and parity tests; no regressions. If `agents-md-handlers.test.ts` times out under parallel load, re-run `pnpm test` once.

- [ ] **Step 8: Commit**

```bash
git add apps/renderer/src/components/agent-panel/LearningPanel.tsx apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m11): add thumb up/down trust feedback to the learning tab"
```

---

## Notes for every task

- Branch is `main`; commit directly to `main` (no feature branch — the established workflow).
- commitlint rejects uppercase / `+` / `%` in the commit subject — use the messages verbatim.
- Run each verification command on its own; confirm the result before committing — never pipe test output through `grep` then `&&` commit (the pipe masks failures).
- TDD: write the test, see it fail, implement, see it pass, commit.
- The pre-commit hook runs prettier/eslint and may reformat — that is expected.
- Do NOT invent repo method names, CSS classes, or import paths — read the actual files and match what exists.

---

## Self-Review notes

- **Spec coverage (§8, §6):** decay open-session → Tasks 2 (math) + 4 (pass) + 5 (boot wiring); `kind='identity'` / `pinned=1` exempt → Task 3 (`listDecayCandidates` query) + Task 4 tests; pruning `importance < 0.1 AND stale > 30d` → Task 4; inbox `memory_review_needed` warns before expiry → Task 1 (kind) + Task 4 (warn-on-crossing-0.2 + prune notice); trust feedback ±0.05/−0.10 → Task 7; `trust < 0.2` leaves L0 → Task 6. **Deliberately deferred to PR-F2** (documented in the scope note): the **consolidation prompt** (§8 "memory.md > 90% cap → next turn merge/trim") — it is a prompt-injection nudge and belongs with PR-F2's nudges-fallback work; Settings (`user.md` editor + derivation budget slider); docs; roadmap. PR-F2 closes M11.
- **Placeholder scan:** every code step ships complete code; every command has an expected result. The decay math is a pure function with explicit clamps; the maintenance pass has a first-run baseline branch, a throttle branch, and a `try/catch` at the boot call site so a failure never blocks startup.
- **Type consistency:** `MaintenanceResult` is defined in Task 4 and consumed in Task 5. `RateDirection` + `TRUST_DELTA` are defined once in `learning-handlers.ts` (Task 7) and the preload/`env.d.ts` use the inline `"up" | "down"` literal (preload boundary convention, mirrors PR-E2). `decayFactor`/`decayedImportance` defined in Task 2, consumed in Task 4. `bumpTrust` returns the updated `Memory`/`Skill` — consistent across repo (Task 3), handler (Task 7), preload, and UI (Task 8). `listDecayCandidates` defined in Task 3, consumed in Task 4.
- **Non-regression:** `buildMemoryBlock` only gains a filter — Task 6 reruns the whole `system-prompt-memory.test.ts`. The maintenance pass is additive and guarded; it touches only `memories` rows and `inbox_items` + the `settings` k-v table. The 20-hour throttle keeps it from over-decaying on frequent relaunches; the first-run baseline keeps a fresh install from decaying day-one memories. `KIND_BORDER` being `Record<InboxKind, ...>` means a missing key is a typecheck failure, not a silent gap.
- **Security:** trust feedback is user-driven (no LLM path); no sanitizer concern. The maintenance pass reads/writes only numeric importance + soft-delete flags + inbox rows — no untrusted text enters. No new SQL injection surface (`bumpTrust` and `listDecayCandidates` are parameterized / constant SQL).
