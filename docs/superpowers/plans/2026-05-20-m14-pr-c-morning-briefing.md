# M14 PR-C — Morning Briefing (Vitrine Matinal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **Vitrine Matinal** — a daily triage page that becomes the app's landing route. It aggregates "Precisa de você" (pending approvals + verification reviews + trust promotion suggestions + agent errors) at the top, with smaller buckets below (verified · failed · in-progress · learned · cost). A short AI-generated headline (cached by counter hash) sits above the buckets. Read-model over existing tables; one new column for the "since reviewed" cursor.

**Architecture:** Renderer landing route consumes `briefing:get` IPC which returns a `Briefing` shape built by `buildBriefing(db, companyId, sinceTs, now)` — pure SQL JOINs over `approvals` (M7.5), `inbox_items` (M11+), `goals` (M8.5+M13), `goal_criteria` (M13), `skill_candidates` (M11), `cost_events` (M8). The headline is one `claude -p` call (reuses the M11 derivation runner / `buildAuthEnv` / `estimateCostCents` pattern from `telos-synthesis.ts`) cached by hash of the contagem inputs — opening the Vitrine 5× in the same state costs **zero** new calls. Cursor lives in `companies.briefing_reviewed_at`. Landing target flips from `/dashboard` to `/briefing`; the Dashboard stays accessible at its current route.

**Tech Stack:** TypeScript (strict + `exactOptionalPropertyTypes`), Electron, better-sqlite3, React 18, Tailwind, react-i18next, vitest. pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-05-18-m14-vitrine-confianca-design.md` — §5 (Peça 2 — Vitrine Matinal), §7 (migration M14-03), §9 (IPC), §11 row C. M14 PR-A + PR-B already merged (HEAD `309a45f` at plan time; 1625 tests).

**Locked design decisions:**
- **Bundled PR in `main`** — same pattern as PR-A/B.
- **Briefing is a read-model on existing tables.** No new tables besides the cursor column.
- **Cursor:** `companies.briefing_reviewed_at INTEGER` (nullable; NULL = "show everything from the last 24h" default window).
- **Headline cache:** a sibling column `companies.briefing_headline_json TEXT` storing `{ hash, text, generatedAt }`. JSON, no new table (single row per company; tiny payload). When the hash matches the current counters, reuse the text. When it differs (or no row), regenerate.
- **Manchete model:** `claude-sonnet-4-6` (cheapest sustained quality — same as `charter-generation.ts`, `telos-synthesis.ts`). Costs recorded in `cost_events` with `adapter_name='briefing-headline'`.
- **Graceful degradation:** if the headline call fails (no `claude` CLI on this machine, network blip, etc.), the renderer shows a determinístico fallback: `${verified.length} entregues · ${needsYou.length} precisam de você`. The Vitrine never breaks because of the headline. The cache write is **skipped on failure** so the next call retries.
- **Landing route:** the wildcard `*` redirect changes from `/dashboard` to `/briefing` (with the same auth gate). `/dashboard` stays at its current URL and stays in the sidebar nav.
- **Sidebar nav:** the "Início"/"Briefing" link is added as the **first** item, above "Dashboard". Tied to `t("nav.briefing")`.
- **No new MCP tools.** PR-C is host + renderer only.
- **i18n parity** in both `en-US.json` and `pt-BR.json` (parity test enforces).
- **Smoke pending (`claude -p` headless never ran live)** — applies to the headline. The renderer shows the deterministic fallback in this environment; the cached-headline code path stays tested via injected `runDerivation` stub.
- **Out of scope:** OS notifications / push (spec §14 — explicitly deferred); merging Dashboard ↔ Briefing (spec §14); the "blockedReason" tooltip on the trust badge (PR-D); the inbox card render of `trust_promotion_suggested` from inside the Vitrine (already exists in `/inbox` via PR-B — Vitrine deep-links to `/inbox` instead of duplicating the card).

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `apps/main/src/db/migrations/0034_m14_briefing.sql` | `companies.briefing_reviewed_at` + `companies.briefing_headline_json` |
| `apps/main/src/db/migrations/0034.test.ts` | Migration smoke — both columns exist, NULL on existing rows |
| `packages/shared/src/types/briefing.ts` | `Briefing` + `BriefingItem` types |
| `apps/main/src/briefing/build.ts` (+ `.test.ts`) | `buildBriefing(db, companyId, sinceTs, now)` — read-model |
| `apps/main/src/briefing/headline.ts` (+ `.test.ts`) | `generateBriefingHeadline(deps, input)` — `claude -p` call with cache + cost record + fallback |
| `apps/main/src/ipc/briefing-handlers.ts` (+ `apps/main/tests/briefing-handlers.test.ts`) | IPC `briefing:get` + `briefing:mark-reviewed` |
| `apps/renderer/src/routes/Briefing.tsx` | The landing page |
| `apps/renderer/src/stores/briefing.ts` | zustand store: `briefing` + `load(companyId)` + `markReviewed(companyId)` |

**Modified files:**

| File | Change |
|------|--------|
| `packages/shared/src/types/index.ts` | `export * from "./briefing.js"` |
| `packages/shared/src/types/company.ts` | `Company` += `briefingReviewedAt: number \| null` |
| `apps/main/src/companies/repository.ts` | Row mapper reads the new column; new `setBriefingReviewedAt(id, ts)` + `getBriefingHeadline(id)` + `setBriefingHeadline(id, json)` methods |
| `apps/main/src/companies/seed.ts` (or wherever new companies get created) | No-op — new columns default to NULL (back-compat preserved) |
| `packages/shared/src/ipc-channels.ts` | `BRIEFING_GET: "briefing:get"`, `BRIEFING_MARK_REVIEWED: "briefing:mark-reviewed"` |
| `apps/main/src/ipc/handlers.ts` | Register `registerBriefingHandlers(db)` |
| `apps/main/src/ipc/preload.ts` + `apps/renderer/src/env.d.ts` | Expose `briefing.get` / `briefing.markReviewed` |
| `apps/renderer/src/App.tsx` | New `/briefing` route + change wildcard redirect target + sidebar `NavLink` |
| `apps/renderer/src/i18n/en-US.json` + `pt-BR.json` | `nav.briefing` + `briefing.*` keys |
| `apps/main/src/companies/import-schema.ts` + `import.ts` + `export.ts` | The cursor + cache columns are write-only by the briefing module — `import.ts` ignores them on restore (they reset for a fresh company; matches existing `telos_path` semantics). **No schema change for the snapshot** — the new columns are absent from export. |
| Mock literals of `Company` in tests | Add `briefingReviewedAt: null` (recurring pattern). |

**Why this split:**
- `build.ts` and `headline.ts` are separable because the headline is the only piece that touches `claude -p` (slow, flaky in environments without CLI) — keep it isolated so `build.ts` can be tested deterministically.
- The IPC handler glues both; tests inject a stub `runDerivation` mirroring the `telos-synthesis.test.ts` pattern.
- The store keeps state out of the route component so the cursor + headline reuse across navigations.

---

## Task 1: Migration `0034` — `briefing_reviewed_at` + `briefing_headline_json`

**Files:**
- Create: `apps/main/src/db/migrations/0034_m14_briefing.sql`
- Create: `apps/main/src/db/migrations/0034.test.ts`

> Read `apps/main/src/db/migrations/0029_m13_telos.sql` (closest precedent — also adds a column to `companies` for an artifact path). Two simple `ALTER TABLE ADD COLUMN` calls, no recreate needed (CHECK constraints are not affected).

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/db/migrations/0034.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0034 — companies.briefing_reviewed_at + briefing_headline_json", () => {
  it("adds both columns, defaulting to NULL on existing rows", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    const row = db
      .prepare("SELECT briefing_reviewed_at, briefing_headline_json FROM companies WHERE id = ?")
      .get("c1") as { briefing_reviewed_at: number | null; briefing_headline_json: string | null };
    expect(row.briefing_reviewed_at).toBeNull();
    expect(row.briefing_headline_json).toBeNull();
  });

  it("allows writing both columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    db.prepare(
      "UPDATE companies SET briefing_reviewed_at = ?, briefing_headline_json = ? WHERE id = ?",
    ).run(123, '{"hash":"x","text":"y","generatedAt":1}', "c1");
    const row = db
      .prepare("SELECT briefing_reviewed_at, briefing_headline_json FROM companies WHERE id = ?")
      .get("c1") as { briefing_reviewed_at: number | null; briefing_headline_json: string | null };
    expect(row.briefing_reviewed_at).toBe(123);
    expect(row.briefing_headline_json).toContain("hash");
  });
});
```

Run: `pnpm --filter @prospero/main test "0034"`
Expected: FAIL — migration does not exist.

- [ ] **Step 2: Write the migration**

Create `apps/main/src/db/migrations/0034_m14_briefing.sql`:

```sql
-- M14 PR-C Task 1: Morning Briefing — cursor + headline cache columns on
-- `companies`. Both are NULL on existing rows; the renderer treats NULL as
-- "show everything from the default window" (24h) for the cursor and "no
-- cache yet" for the headline. Additive ALTERs — no recreate needed.

ALTER TABLE companies ADD COLUMN briefing_reviewed_at INTEGER;
ALTER TABLE companies ADD COLUMN briefing_headline_json TEXT;
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "0034"`
Expected: PASS — 2 cases.
Run: `pnpm --filter @prospero/main test "migration"`
Expected: every existing migration test still green.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/db/migrations/0034_m14_briefing.sql apps/main/src/db/migrations/0034.test.ts
git commit -m "feat(briefing): add briefing_reviewed_at and headline cache columns"
```

---

## Task 2: Shared types + `Company.briefingReviewedAt`

**Files:**
- Create: `packages/shared/src/types/briefing.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/types/company.ts`

> Read `packages/shared/src/types/company.ts` and the existing `index.ts` to slot the new types where they belong. `Company` is consumed by the IPC + renderer — adding a required field will break literals in tests (recurring pattern).

- [ ] **Step 1: Create the briefing types file**

Create `packages/shared/src/types/briefing.ts`:

```typescript
// M14 PR-C — Morning Briefing shape exposed via `briefing:get`. Read-model
// over existing tables (no new shape persisted); the headline is the only
// AI-generated piece, cached on the company row.

export interface BriefingItem {
  /** Unique key for React lists; usually the source row id (inbox/goal/etc). */
  id: string;
  /** Short human label — e.g. "Verification failed — Goal 'Launch'". */
  label: string;
  /** One-line detail (truncated to 200 chars by build.ts). */
  detail: string;
  /** Deep-link route in the app (e.g. /goals/<id>, /inbox). */
  route: string;
  /** Source agent name when known; null for non-agent items. */
  agentName: string | null;
}

export interface Briefing {
  /** AI-generated one-line manchete; falls back to deterministic text on failure. */
  headline: string;
  /** Pending approvals + verification reviews + trust promotion suggestions + agent errors. */
  needsYou: BriefingItem[];
  /** Goals that reached `achieved` since the cursor. */
  verified: BriefingItem[];
  /** verification_failed inbox + agent errors since the cursor. */
  failed: BriefingItem[];
  /** Issues/goals in progress right now. */
  inProgress: BriefingItem[];
  /** skill_candidate_pending inbox items since the cursor. */
  learned: BriefingItem[];
  /** Sum of cost_events.cost_cents_estimate since the cursor (USD cents). */
  costCents: number;
  /** When this briefing object was built. */
  generatedAt: number;
  /** Cursor — last time the user pressed "Mark as reviewed". null = first time. */
  reviewedAt: number | null;
}
```

- [ ] **Step 2: Export from the shared index**

In `packages/shared/src/types/index.ts`, add (read the file first; pick the right alphabetical slot — likely near `activity` or `company`):

```typescript
export * from "./briefing.js";
```

- [ ] **Step 3: Extend `Company`**

In `packages/shared/src/types/company.ts`, locate the `Company` type. Add the field:

```typescript
export type Company = {
  id: string;
  name: string;
  createdAt: number;
  telosPath: string | null;
  briefingReviewedAt: number | null;
};
```

(Confirm the exact existing fields — copy them verbatim, then add the new one at the bottom.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/main typecheck`
Expected: **EXPECTED TO FAIL** at `apps/main/src/companies/repository.ts` because the row mapper does not yet read the new column. **This failure is the test of Task 3.** Note the error and move on — they commit together.

Do **not** commit at the end of Task 2. Task 3 bundles them.

---

## Task 3: Companies repo — mapper + setters

**Files:**
- Modify: `apps/main/src/companies/repository.ts`

> Read `apps/main/src/companies/repository.ts` end-to-end. It uses explicit column SELECTs (not `SELECT *`) — every column has to be listed by name. The mapper `rowToCompany` reads from the row. Add the new column to all SELECTs + the mapper + two setters (`setBriefingReviewedAt`, `setBriefingHeadline`). Also add a getter `getBriefingHeadline(id)` returning the raw JSON string (or null).

- [ ] **Step 1: Update the repo**

In `apps/main/src/companies/repository.ts`:

1. Extend the row type and `rowToCompany` mapper:

```typescript
const rowToCompany = (row: {
  id: string;
  name: string;
  created_at: number;
  telos_path: string | null;
  briefing_reviewed_at: number | null;
}): Company => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  telosPath: row.telos_path,
  briefingReviewedAt: row.briefing_reviewed_at,
});
```

2. Update **every** explicit SELECT (likely 3-4 prepared statements at the top of `createCompaniesRepository`) to include `briefing_reviewed_at` in the column list:

```typescript
const selectByIdStmt = db.prepare(
  "SELECT id, name, created_at, telos_path, briefing_reviewed_at FROM companies WHERE id = ?",
);
const listStmt = db.prepare(
  "SELECT id, name, created_at, telos_path, briefing_reviewed_at FROM companies ORDER BY created_at ASC",
);
```

(Also any `rowToCompany` cast call site — the inline `as { id; name; created_at; telos_path }` types need the new column.)

3. Extend the `CompaniesRepository` interface:

```typescript
export type CompaniesRepository = {
  create(input: { name: string }): Company;
  getById(id: string): Company | null;
  list(): Company[];
  delete(id: string): void;
  setTelosPath(id: string, telosPath: string): void;
  setBriefingReviewedAt(id: string, reviewedAt: number): void;
  setBriefingHeadline(id: string, json: string): void;
  getBriefingHeadlineRaw(id: string): string | null;
};
```

4. Add the implementations inside `createCompaniesRepository`:

```typescript
const setBriefingReviewedAtStmt = db.prepare(
  "UPDATE companies SET briefing_reviewed_at = ? WHERE id = ?",
);
const setBriefingHeadlineStmt = db.prepare(
  "UPDATE companies SET briefing_headline_json = ? WHERE id = ?",
);
const getBriefingHeadlineStmt = db.prepare(
  "SELECT briefing_headline_json AS json FROM companies WHERE id = ?",
);
// ...inside the returned object:
setBriefingReviewedAt(id, reviewedAt) {
  setBriefingReviewedAtStmt.run(reviewedAt, id);
},
setBriefingHeadline(id, json) {
  setBriefingHeadlineStmt.run(json, id);
},
getBriefingHeadlineRaw(id) {
  const row = getBriefingHeadlineStmt.get(id) as { json: string | null } | undefined;
  return row?.json ?? null;
},
```

- [ ] **Step 2: Update mock literals of `Company` in tests**

Run:

```
grep -rn "as Company\b" apps/main apps/renderer packages/shared
grep -rln "createdAt:\s*[0-9]" apps/main/tests apps/renderer/src/stores
```

For each `Company` literal that has `telosPath:`, add `briefingReviewedAt: null` on the next line. Likely files: `companies.test.ts`, `companies.repository.test.ts`, `companies.seed.test.ts`, store tests in `apps/renderer/src/stores/companies.test.ts`. **Use perl bulk-patch (project_m14_pr_a_lessons §5) if convenient**:

```bash
perl -i -pe 's/^(\s*)telosPath:\s*null,?\s*$/$1telosPath: null,\n$1briefingReviewedAt: null,/' <file1> <file2> ...
```

Confirm by typechecking after.

- [ ] **Step 3: Run typecheck across the workspace**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Run the companies suite**

Run: `pnpm --filter @prospero/main test companies`
Expected: PASS — every existing test still green.

- [ ] **Step 5: Commit (bundles Task 2 + Task 3)**

```bash
git add packages/shared/src apps/main/src/companies/repository.ts apps/main/tests apps/main/src/companies apps/renderer/src/stores
git commit -m "feat(briefing): wire briefing types through the company repo"
```

(Adjust `git add` to the real files touched in Step 2.)

---

## Task 4: `buildBriefing` — the read-model

**Files:**
- Create: `apps/main/src/briefing/build.ts`
- Create: `apps/main/src/briefing/build.test.ts`

> Read `apps/main/src/trust/track-record.ts` (M14 PR-A) for the exact SQL idiom this codebase uses (prepared statements per row + `as { … }` casts). The query set is similar — JOIN-heavy but read-only. Use 24h as the default window when `sinceTs` is `null`.

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/briefing/build.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBriefing, DEFAULT_WINDOW_MS } from "./build.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const applyMigrations = (db: Database.Database) => {
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
};

const seed = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,?)").run("c1", "Acme", now);
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','Alice','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(now, now);
  return { db, now };
};

describe("buildBriefing", () => {
  it("returns empty buckets and zero cost for a fresh company", () => {
    const { db, now } = seed();
    const b = buildBriefing(db, "c1", null, now);
    expect(b.needsYou).toHaveLength(0);
    expect(b.verified).toHaveLength(0);
    expect(b.failed).toHaveLength(0);
    expect(b.inProgress).toHaveLength(0);
    expect(b.learned).toHaveLength(0);
    expect(b.costCents).toBe(0);
    expect(b.reviewedAt).toBeNull();
  });

  it("collects pending approvals + verification_failed + verification_review + trust_promotion_suggested + agent_unresponsive into needsYou", () => {
    const { db, now } = seed();
    const insert = (kind: string, title: string, id: string) =>
      db.prepare(
        "INSERT INTO inbox_items (id, company_id, kind, actor_id, title, preview, requires_action, created_at) VALUES (?,?,?,?,?,?,1,?)",
      ).run(id, "c1", kind, "a1", title, null, now - 1000);
    insert("approval", "approval-1", "i1");
    insert("verification_failed", "verif-fail", "i2");
    insert("verification_review", "verif-review", "i3");
    insert("trust_promotion_suggested", "trust-promo", "i4");
    insert("agent_unresponsive", "stuck", "i5");
    // Add a benign kind that should NOT land in needsYou.
    insert("completed", "yay", "i6");

    const b = buildBriefing(db, "c1", null, now);
    const ids = b.needsYou.map((i) => i.id).sort();
    expect(ids).toEqual(["i1", "i2", "i3", "i4", "i5"]);
  });

  it("collects goals achieved since the cursor into verified", () => {
    const { db, now } = seed();
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("g_old", "c1", "a1", "Old goal", "x", "task", "achieved", now - 1000 * 60 * 60 * 48, now - 1000 * 60 * 60 * 48);
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("g_new", "c1", "a1", "Recent goal", "x", "task", "achieved", now - 1000, now - 1000);
    // Cursor at 24h ago: only g_new counts.
    const cursor = now - 24 * 60 * 60 * 1000;
    const b = buildBriefing(db, "c1", cursor, now);
    expect(b.verified.map((g) => g.id)).toEqual(["g_new"]);
  });

  it("sums cost_events.cost_cents_estimate since the cursor into costCents", () => {
    const { db, now } = seed();
    db.prepare(
      "INSERT INTO cost_events (id, company_id, agent_id, project_id, issue_id, adapter_name, model, session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_cents_estimate, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run("ce1", "c1", "a1", null, null, "claude-oauth-local", "claude-sonnet-4-6", null, 100, 100, 0, 0, 13, now - 500);
    db.prepare(
      "INSERT INTO cost_events (id, company_id, agent_id, project_id, issue_id, adapter_name, model, session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_cents_estimate, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run("ce_old", "c1", "a1", null, null, "claude-oauth-local", "claude-sonnet-4-6", null, 100, 100, 0, 0, 99, now - DEFAULT_WINDOW_MS - 1000);
    const b = buildBriefing(db, "c1", null, now);
    expect(b.costCents).toBe(13);
  });

  it("reports the cursor on the returned briefing", () => {
    const { db, now } = seed();
    const cursor = now - 60_000;
    db.prepare("UPDATE companies SET briefing_reviewed_at = ? WHERE id = ?").run(cursor, "c1");
    const b = buildBriefing(db, "c1", cursor, now);
    expect(b.reviewedAt).toBe(cursor);
  });

  it("uses the 24h default window when sinceTs is null", () => {
    const { db, now } = seed();
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("g1", "c1", "a1", "Recent", "x", "task", "achieved", now - 60_000, now - 60_000);
    db.prepare(
      "INSERT INTO goals (id, company_id, owner_agent_id, title, success_criteria, level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("g2", "c1", "a1", "Old", "x", "task", "achieved", now - DEFAULT_WINDOW_MS - 60_000, now - DEFAULT_WINDOW_MS - 60_000);
    const b = buildBriefing(db, "c1", null, now);
    expect(b.verified.map((g) => g.id)).toEqual(["g1"]);
  });
});
```

Run: `pnpm --filter @prospero/main test "briefing/build"`
Expected: FAIL — module missing.

- [ ] **Step 2: Write `build.ts`**

Create `apps/main/src/briefing/build.ts`:

```typescript
import type Database from "better-sqlite3";
import type { Briefing, BriefingItem } from "@prospero/shared";

// M14 PR-C — Morning Briefing read-model. Pure SQL JOINs on existing tables
// (no new state besides the cursor on `companies`). Headline is built
// separately by `headline.ts` and stitched in by the IPC handler.
//
// Window semantics: when sinceTs is null, the default 24h window is used.
// When non-null, items strictly after sinceTs land in the buckets.

export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREVIEW_MAX = 200;

const NEEDS_YOU_KINDS = [
  "approval",
  "verification_failed",
  "verification_review",
  "trust_promotion_suggested",
  "agent_unresponsive",
  "goal_error",
  "budget_warning",
];

const truncate = (s: string | null): string => {
  if (s === null) return "";
  return s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX - 1)}…` : s;
};

const inboxRoute = (kind: string, payloadJson: string | null): string => {
  if (kind === "goal_proposed" || kind === "goal_executing" || kind === "goal_error" || kind === "goal_retrospective_ready" || kind === "verification_failed" || kind === "verification_review") {
    if (payloadJson === null) return "/inbox";
    try {
      const parsed = JSON.parse(payloadJson) as { goalId?: unknown };
      if (typeof parsed.goalId === "string") return `/goals/${parsed.goalId}`;
    } catch {
      /* fall through */
    }
  }
  return "/inbox";
};

export const buildBriefing = (
  db: Database.Database,
  companyId: string,
  sinceTs: number | null,
  now: number,
): Briefing => {
  const since = sinceTs ?? now - DEFAULT_WINDOW_MS;

  // 1. needsYou — pending inbox items in the action-required kinds.
  const inboxRows = db
    .prepare(
      `SELECT i.id, i.kind, i.title, i.preview, i.payload_json AS payload_json, i.actor_id, a.name AS agent_name
         FROM inbox_items i
         LEFT JOIN agents a ON a.id = i.actor_id
        WHERE i.company_id = ?
          AND i.read_at IS NULL
          AND i.requires_action = 1
          AND i.kind IN (${NEEDS_YOU_KINDS.map(() => "?").join(",")})
        ORDER BY i.created_at DESC`,
    )
    .all(companyId, ...NEEDS_YOU_KINDS) as Array<{
    id: string;
    kind: string;
    title: string;
    preview: string | null;
    payload_json: string | null;
    actor_id: string | null;
    agent_name: string | null;
  }>;
  const needsYou: BriefingItem[] = inboxRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: truncate(r.preview),
    route: inboxRoute(r.kind, r.payload_json),
    agentName: r.agent_name,
  }));

  // 2. verified — goals achieved since the cursor.
  const verifiedRows = db
    .prepare(
      `SELECT g.id, g.title, g.updated_at, a.name AS agent_name
         FROM goals g
         LEFT JOIN agents a ON a.id = g.owner_agent_id
        WHERE g.company_id = ?
          AND g.status = 'achieved'
          AND g.updated_at > ?
        ORDER BY g.updated_at DESC`,
    )
    .all(companyId, since) as Array<{ id: string; title: string; updated_at: number; agent_name: string | null }>;
  const verified: BriefingItem[] = verifiedRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: r.agent_name !== null ? `Owned by ${r.agent_name}` : "Goal closed",
    route: `/goals/${r.id}`,
    agentName: r.agent_name,
  }));

  // 3. failed — verification_failed inbox + goal_error inbox + agent error in
  //    activity_events since the cursor. The action-required ones already
  //    landed in needsYou; here we list the read/historical ones too.
  const failedRows = db
    .prepare(
      `SELECT i.id, i.title, i.preview, i.payload_json, i.kind, a.name AS agent_name
         FROM inbox_items i
         LEFT JOIN agents a ON a.id = i.actor_id
        WHERE i.company_id = ?
          AND i.kind IN ('verification_failed','goal_error')
          AND i.created_at > ?
        ORDER BY i.created_at DESC`,
    )
    .all(companyId, since) as Array<{
    id: string;
    title: string;
    preview: string | null;
    payload_json: string | null;
    kind: string;
    agent_name: string | null;
  }>;
  const failed: BriefingItem[] = failedRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: truncate(r.preview),
    route: inboxRoute(r.kind, r.payload_json),
    agentName: r.agent_name,
  }));

  // 4. inProgress — issues in 'doing'/'review' right now.
  const inProgressRows = db
    .prepare(
      `SELECT i.id, i.title, i.status, a.name AS agent_name
         FROM issues i
         LEFT JOIN agents a ON a.id = i.assignee_agent_id
        WHERE i.company_id = ?
          AND i.status IN ('doing','review')
        ORDER BY i.updated_at DESC`,
    )
    .all(companyId) as Array<{ id: string; title: string; status: string; agent_name: string | null }>;
  const inProgress: BriefingItem[] = inProgressRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: r.status === "review" ? "In review" : "Doing",
    route: "/issues",
    agentName: r.agent_name,
  }));

  // 5. learned — skill_candidate_pending inbox since cursor (pending review).
  const learnedRows = db
    .prepare(
      `SELECT i.id, i.title, i.preview, a.name AS agent_name
         FROM inbox_items i
         LEFT JOIN agents a ON a.id = i.actor_id
        WHERE i.company_id = ?
          AND i.kind = 'skill_candidate_pending'
          AND i.created_at > ?
        ORDER BY i.created_at DESC`,
    )
    .all(companyId, since) as Array<{ id: string; title: string; preview: string | null; agent_name: string | null }>;
  const learned: BriefingItem[] = learnedRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: truncate(r.preview),
    route: "/inbox",
    agentName: r.agent_name,
  }));

  // 6. costCents — sum of cost_events since the cursor.
  const costRow = db
    .prepare(
      `SELECT COALESCE(SUM(cost_cents_estimate), 0) AS sum
         FROM cost_events
        WHERE company_id = ?
          AND occurred_at > ?`,
    )
    .get(companyId, since) as { sum: number };
  const costCents = costRow.sum;

  // 7. reviewedAt — read the cursor from the companies row.
  const cursorRow = db
    .prepare("SELECT briefing_reviewed_at AS reviewed_at FROM companies WHERE id = ?")
    .get(companyId) as { reviewed_at: number | null } | undefined;
  const reviewedAt = cursorRow?.reviewed_at ?? null;

  return {
    headline: "",
    needsYou,
    verified,
    failed,
    inProgress,
    learned,
    costCents,
    generatedAt: now,
    reviewedAt,
  };
};
```

> **Adapt point:** verify the column names by reading the migrations:
> - `inbox_items` schema → `apps/main/src/db/migrations/0033_m14_inbox_trust_promotion.sql` (most recent recreate; includes the full column list). Confirm `payload_json`, `actor_id`, `requires_action`.
> - `issues` schema → grep the migrations for `CREATE TABLE issues` and for the `assignee_agent_id` column (may have a different name like `assigned_agent_id`).
> - `cost_events` schema → `apps/main/src/db/migrations/0011_cost_events.sql`. Confirm `cost_cents_estimate` vs. `cost_cents`.
>
> If a column name differs, fix the SQL BEFORE running the test. The seed in Step 1 uses the same names, so seed and query must agree.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "briefing/build"`
Expected: PASS — 6 cases.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/briefing/build.ts apps/main/src/briefing/build.test.ts
git commit -m "feat(briefing): add buildBriefing read-model"
```

---

## Task 5: `generateBriefingHeadline` — `claude -p` with cache + cost record + fallback

**Files:**
- Create: `apps/main/src/briefing/headline.ts`
- Create: `apps/main/src/briefing/headline.test.ts`

> Read `apps/main/src/companies/telos-synthesis.ts` end-to-end as the closest precedent (same pattern: injected `runDerivation` + sanitize + cost record). The hash input is the counters object `{ verified, failed, needsYou, learned, inProgress, costCents }` — JSON-stringify it (stable key order — use `Object.keys(obj).sort()` or just write the object literal in fixed order), then SHA-256 (use `node:crypto`'s `createHash`).

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/briefing/headline.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBriefingHeadline } from "./headline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setup = () => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,?)").run("c1", "Acme", Date.now());
  return db;
};

const counters = { verified: 3, failed: 1, needsYou: 2, learned: 0, inProgress: 4, costCents: 50 };

describe("generateBriefingHeadline", () => {
  it("calls runDerivation on first request and writes to the cache", async () => {
    const db = setup();
    const runDerivation = vi.fn().mockResolvedValue({
      text: "Three outcomes shipped overnight; two need a look.",
      usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
    });
    const text = await generateBriefingHeadline(
      { db, runDerivation },
      { companyId: "c1", counters, env: {} },
    );
    expect(text).toMatch(/three outcomes/i);
    expect(runDerivation).toHaveBeenCalledTimes(1);
    const row = db
      .prepare("SELECT briefing_headline_json AS json FROM companies WHERE id = ?")
      .get("c1") as { json: string | null };
    expect(row.json).not.toBeNull();
    const parsed = JSON.parse(row.json!) as { hash: string; text: string };
    expect(parsed.text).toContain("Three outcomes");
  });

  it("reuses the cache when the hash matches", async () => {
    const db = setup();
    const runDerivation = vi.fn().mockResolvedValue({
      text: "Headline-A",
      usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
    });
    await generateBriefingHeadline({ db, runDerivation }, { companyId: "c1", counters, env: {} });
    // Same counters, same hash → no second runDerivation call.
    const text2 = await generateBriefingHeadline(
      { db, runDerivation },
      { companyId: "c1", counters, env: {} },
    );
    expect(text2).toBe("Headline-A");
    expect(runDerivation).toHaveBeenCalledTimes(1);
  });

  it("regenerates when counters change", async () => {
    const db = setup();
    const runDerivation = vi
      .fn()
      .mockResolvedValueOnce({
        text: "Headline-A",
        usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
      })
      .mockResolvedValueOnce({
        text: "Headline-B",
        usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
      });
    await generateBriefingHeadline({ db, runDerivation }, { companyId: "c1", counters, env: {} });
    const text2 = await generateBriefingHeadline(
      { db, runDerivation },
      { companyId: "c1", counters: { ...counters, verified: 99 }, env: {} },
    );
    expect(text2).toBe("Headline-B");
    expect(runDerivation).toHaveBeenCalledTimes(2);
  });

  it("falls back to a deterministic string when runDerivation throws", async () => {
    const db = setup();
    const runDerivation = vi.fn().mockRejectedValue(new Error("no claude CLI"));
    const text = await generateBriefingHeadline(
      { db, runDerivation },
      { companyId: "c1", counters, env: {} },
    );
    expect(text).toMatch(/3.*delivered.*2.*need/i);
    // Cache should NOT be written on failure (so the next call retries).
    const row = db
      .prepare("SELECT briefing_headline_json AS json FROM companies WHERE id = ?")
      .get("c1") as { json: string | null };
    expect(row.json).toBeNull();
  });

  it("records a cost_events row on a successful call", async () => {
    const db = setup();
    const runDerivation = vi.fn().mockResolvedValue({
      text: "Headline",
      usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
    });
    await generateBriefingHeadline({ db, runDerivation }, { companyId: "c1", counters, env: {} });
    const row = db
      .prepare("SELECT adapter_name FROM cost_events WHERE company_id = ?")
      .get("c1") as { adapter_name: string };
    expect(row.adapter_name).toBe("briefing-headline");
  });
});
```

Run: `pnpm --filter @prospero/main test "briefing/headline"`
Expected: FAIL — module missing.

- [ ] **Step 2: Write `headline.ts`**

Create `apps/main/src/briefing/headline.ts`:

```typescript
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createCompaniesRepository } from "../companies/repository.js";
import { createCostsRepository } from "../costs/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import type { RunDerivationResult } from "../derivation/runner.js";

// M14 PR-C — generates the Vitrine's one-line headline via a `claude -p` call.
// Cached on `companies.briefing_headline_json` by hash of the input counters
// (stable JSON of the object below) so opening the page in the same state
// costs zero new calls. Cost recorded with adapter_name='briefing-headline'.
// On failure, returns a deterministic fallback and skips cache write so the
// next call retries.

const HEADLINE_MODEL = "claude-sonnet-4-6";

export interface BriefingCounters {
  verified: number;
  failed: number;
  needsYou: number;
  learned: number;
  inProgress: number;
  costCents: number;
}

export type GenerateBriefingHeadlineDeps = {
  db: Database.Database;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

export type GenerateBriefingHeadlineInput = {
  companyId: string;
  counters: BriefingCounters;
  env: Record<string, string>;
};

const buildPrompt = (counters: BriefingCounters): string =>
  [
    "You write a single short headline (max 20 words) summarising what an",
    "autonomous AI company did overnight. Be concrete, not promotional.",
    "Mention only what is non-zero. Output the headline alone — no quotes,",
    "no preamble, no commentary.",
    "",
    `Goals reached: ${counters.verified}`,
    `Verifications failed: ${counters.failed}`,
    `Items waiting on the user: ${counters.needsYou}`,
    `New skills learned: ${counters.learned}`,
    `In progress right now: ${counters.inProgress}`,
    `Cost spent (USD cents): ${counters.costCents}`,
  ].join("\n");

const stableHash = (counters: BriefingCounters): string => {
  // Fixed key order — do NOT rely on JSON.stringify object iteration.
  const stable = [
    counters.verified,
    counters.failed,
    counters.needsYou,
    counters.learned,
    counters.inProgress,
    counters.costCents,
  ].join("|");
  return createHash("sha256").update(stable).digest("hex");
};

const fallbackHeadline = (counters: BriefingCounters): string => {
  const parts: string[] = [];
  if (counters.verified > 0) parts.push(`${counters.verified} delivered`);
  if (counters.failed > 0) parts.push(`${counters.failed} failed`);
  if (counters.needsYou > 0) parts.push(`${counters.needsYou} need you`);
  if (counters.inProgress > 0) parts.push(`${counters.inProgress} in progress`);
  if (parts.length === 0) return "Quiet night.";
  return parts.join(" · ");
};

const stripQuotes = (s: string): string => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”"))) {
    return t.slice(1, -1).trim();
  }
  return t;
};

export const generateBriefingHeadline = async (
  deps: GenerateBriefingHeadlineDeps,
  input: GenerateBriefingHeadlineInput,
): Promise<string> => {
  const repo = createCompaniesRepository(deps.db);
  const hash = stableHash(input.counters);

  // Cache hit?
  const cachedRaw = repo.getBriefingHeadlineRaw(input.companyId);
  if (cachedRaw !== null) {
    try {
      const parsed = JSON.parse(cachedRaw) as { hash: string; text: string };
      if (parsed.hash === hash && typeof parsed.text === "string" && parsed.text.length > 0) {
        return parsed.text;
      }
    } catch {
      /* corrupted cache — fall through and regenerate */
    }
  }

  let text: string;
  try {
    const result = await deps.runDerivation({
      prompt: buildPrompt(input.counters),
      model: HEADLINE_MODEL,
      env: input.env,
    });
    text = stripQuotes(result.text);
    if (text === "") throw new Error("empty headline");

    // Record the cost (same pattern as telos-synthesis.ts).
    createCostsRepository(deps.db).insert({
      companyId: input.companyId,
      agentId: null,
      projectId: null,
      issueId: null,
      adapterName: "briefing-headline",
      model: HEADLINE_MODEL,
      sessionId: null,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      cacheCreationTokens: result.usage.cacheCreation,
      cacheReadTokens: result.usage.cacheRead,
      costCentsEstimate: estimateCostCents(HEADLINE_MODEL, {
        input: result.usage.input,
        output: result.usage.output,
        cache_creation: result.usage.cacheCreation,
        cache_read: result.usage.cacheRead,
      }),
      occurredAt: Date.now(),
    });

    repo.setBriefingHeadline(
      input.companyId,
      JSON.stringify({ hash, text, generatedAt: Date.now() }),
    );
    return text;
  } catch (err) {
    console.warn("[briefing] headline generation failed; using fallback", err);
    return fallbackHeadline(input.counters);
  }
};
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @prospero/main test "briefing/headline"`
Expected: PASS — 5 cases.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/briefing/headline.ts apps/main/src/briefing/headline.test.ts
git commit -m "feat(briefing): generate a cached headline via claude -p"
```

---

## Task 6: IPC handlers + channels

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `apps/main/src/ipc/briefing-handlers.ts`
- Create: `apps/main/tests/briefing-handlers.test.ts`
- Modify: `apps/main/src/ipc/handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts` + `apps/renderer/src/env.d.ts`

> Read `apps/main/src/ipc/telos-handlers.ts` for the deps-factory + register pattern with a `runDerivation` injection — same shape. The handler stitches `buildBriefing` + `generateBriefingHeadline` together.

- [ ] **Step 1: Add the channels**

In `packages/shared/src/ipc-channels.ts`, append before the closing `} as const`:

```typescript
BRIEFING_GET: "briefing:get",
BRIEFING_MARK_REVIEWED: "briefing:mark-reviewed",
```

- [ ] **Step 2: Write the failing handler test**

Create `apps/main/tests/briefing-handlers.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { briefingHandlers } from "../src/ipc/briefing-handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));

const setup = () => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../src/db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,?)").run("c1", "Acme", now);
  const runDerivation = vi.fn().mockResolvedValue({
    text: "Stub headline",
    usage: { input: 100, output: 30, cacheCreation: 0, cacheRead: 0 },
  });
  return {
    db,
    now,
    h: briefingHandlers({ db, runDerivation, authEnv: () => ({}) }),
  };
};

describe("briefingHandlers", () => {
  it("get returns a stitched Briefing with the AI headline", async () => {
    const { h } = setup();
    const b = await h.get({ companyId: "c1" });
    expect(b.headline).toBe("Stub headline");
    expect(b.needsYou).toEqual([]);
    expect(b.verified).toEqual([]);
  });

  it("markReviewed advances the cursor", async () => {
    const { db, h } = setup();
    await h.markReviewed({ companyId: "c1" });
    const row = db
      .prepare("SELECT briefing_reviewed_at FROM companies WHERE id = ?")
      .get("c1") as { briefing_reviewed_at: number | null };
    expect(row.briefing_reviewed_at).not.toBeNull();
    expect(typeof row.briefing_reviewed_at).toBe("number");
  });

  it("get returns a deterministic fallback when runDerivation throws", async () => {
    const db = new Database(":memory:");
    const migDir = join(__dirname, "../src/db/migrations");
    for (const f of readdirSync(migDir).sort()) {
      if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
    }
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    const runDerivation = vi.fn().mockRejectedValue(new Error("no claude"));
    const h = briefingHandlers({ db, runDerivation, authEnv: () => ({}) });
    const b = await h.get({ companyId: "c1" });
    // Empty counters → "Quiet night." fallback.
    expect(b.headline).toMatch(/quiet night/i);
  });
});
```

Run: `pnpm --filter @prospero/main test "briefing-handlers"`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the handler**

Create `apps/main/src/ipc/briefing-handlers.ts`:

```typescript
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Briefing } from "@prospero/shared";
import { createCompaniesRepository } from "../companies/repository.js";
import { runDerivation, defaultRunProcess } from "../derivation/runner.js";
import type { RunDerivationResult } from "../derivation/runner.js";
import { buildAuthEnv } from "../derivation/index.js";
import { buildBriefing } from "../briefing/build.js";
import { generateBriefingHeadline } from "../briefing/headline.js";

// M14 PR-C — IPC bridge for the Morning Briefing.
//   briefing:get(companyId)        → Briefing
//   briefing:mark-reviewed(companyId) → void (advances the cursor)

export type BriefingHandlersDeps = {
  db: Database.Database;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
  authEnv: () => Record<string, string>;
};

export type BriefingHandlers = {
  get(args: { companyId: string }): Promise<Briefing>;
  markReviewed(args: { companyId: string }): Promise<void>;
};

export const briefingHandlers = (deps: BriefingHandlersDeps): BriefingHandlers => {
  const companiesRepo = createCompaniesRepository(deps.db);

  return {
    async get({ companyId }) {
      const now = Date.now();
      const company = companiesRepo.getById(companyId);
      const cursor = company?.briefingReviewedAt ?? null;
      const briefing = buildBriefing(deps.db, companyId, cursor, now);

      const headline = await generateBriefingHeadline(
        { db: deps.db, runDerivation: deps.runDerivation },
        {
          companyId,
          counters: {
            verified: briefing.verified.length,
            failed: briefing.failed.length,
            needsYou: briefing.needsYou.length,
            learned: briefing.learned.length,
            inProgress: briefing.inProgress.length,
            costCents: briefing.costCents,
          },
          env: deps.authEnv(),
        },
      );

      return { ...briefing, headline };
    },
    async markReviewed({ companyId }) {
      companiesRepo.setBriefingReviewedAt(companyId, Date.now());
    },
  };
};

export const registerBriefingHandlers = (db: Database.Database): void => {
  const h = briefingHandlers({
    db,
    runDerivation: (input) => runDerivation({ runProcess: defaultRunProcess }, input),
    authEnv: () => buildAuthEnv(db),
  });
  ipcMain.handle(IPC.BRIEFING_GET, (_e, args: { companyId: string }) => h.get(args));
  ipcMain.handle(IPC.BRIEFING_MARK_REVIEWED, (_e, args: { companyId: string }) =>
    h.markReviewed(args),
  );
};
```

- [ ] **Step 4: Run the handler test**

Run: `pnpm --filter @prospero/main test "briefing-handlers"`
Expected: PASS — 3 cases.

- [ ] **Step 5: Register the handler**

In `apps/main/src/ipc/handlers.ts`, add the import:

```typescript
import { registerBriefingHandlers } from "./briefing-handlers.js";
```

And the call (after other `register*Handlers(db)` lines):

```typescript
registerBriefingHandlers(db);
```

- [ ] **Step 6: Expose on the preload bridge**

In `apps/main/src/ipc/preload.ts`, add `Briefing` to the imports from `@prospero/shared`, then add the namespace (next to `trust`):

```typescript
briefing: {
  get: (args: { companyId: string }) =>
    ipcRenderer.invoke(IPC.BRIEFING_GET, args) as Promise<Briefing>,
  markReviewed: (args: { companyId: string }) =>
    ipcRenderer.invoke(IPC.BRIEFING_MARK_REVIEWED, args) as Promise<void>,
},
```

In `apps/renderer/src/env.d.ts`, add `Briefing` to imports + mirror the namespace:

```typescript
briefing: {
  get: (args: { companyId: string }) => Promise<Briefing>;
  markReviewed: (args: { companyId: string }) => Promise<void>;
};
```

- [ ] **Step 7: Typecheck + IPC channels sanity**

Run: `pnpm --filter @prospero/main typecheck`
Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/shared test ipc-channels`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/briefing-handlers.ts apps/main/tests/briefing-handlers.test.ts apps/main/src/ipc/handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(briefing): add briefing:get and briefing:mark-reviewed ipc"
```

---

## Task 7: Renderer store

**Files:**
- Create: `apps/renderer/src/stores/briefing.ts`

> Read `apps/renderer/src/stores/companies.ts` for the zustand pattern. The store has one piece of state (`briefing: Briefing | null`) + two actions (`load`, `markReviewed`). No persistence; refetch on company switch.

- [ ] **Step 1: Write the store**

Create `apps/renderer/src/stores/briefing.ts`:

```typescript
import { create } from "zustand";
import type { Briefing } from "@prospero/shared";

interface BriefingState {
  briefing: Briefing | null;
  loading: boolean;
  error: string | null;
  load: (companyId: string) => Promise<void>;
  markReviewed: (companyId: string) => Promise<void>;
}

export const useBriefingStore = create<BriefingState>((set) => ({
  briefing: null,
  loading: false,
  error: null,
  async load(companyId) {
    set({ loading: true, error: null });
    try {
      const b = await window.prospero.briefing.get({ companyId });
      set({ briefing: b, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  async markReviewed(companyId) {
    await window.prospero.briefing.markReviewed({ companyId });
    // Re-load so the buckets reflect the new cursor.
    set({ loading: true });
    try {
      const b = await window.prospero.briefing.get({ companyId });
      set({ briefing: b, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/stores/briefing.ts
git commit -m "feat(briefing): add renderer store"
```

---

## Task 8: Briefing route component

**Files:**
- Create: `apps/renderer/src/routes/Briefing.tsx`

> Read `apps/renderer/src/components/IsaPanel.tsx` (M13 PR-F polish) for the loading/empty/error idiom that already exists. The Briefing keeps the M14 spec's triage posture: "Precisa de você" dominates the top (large heading + items in a stack); the other buckets sit in a colapsável strip below. Cost footer at the bottom.

- [ ] **Step 1: Write the component**

Create `apps/renderer/src/routes/Briefing.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBriefingStore } from "../stores/briefing.js";
import { useCompaniesStore } from "../stores/companies.js";
import { formatCents } from "../lib/costs/formatCents.js";
import type { BriefingItem } from "@prospero/shared";

// M14 PR-C — Vitrine Matinal. Triage page: "Precisa de você" dominates the
// top, the smaller buckets live in a colapsável strip below, cost as a footer.
// Renders nothing until a company is active; reloads when the active company
// changes.

const ItemRow: FC<{ item: BriefingItem; onClick?: () => void }> = ({ item, onClick }) => (
  <Link
    to={item.route}
    onClick={onClick}
    className="block px-3 py-2 rounded bg-surface-soft hover:bg-surface-border border border-surface-border"
  >
    <p className="text-sm font-semibold text-ink truncate">{item.label}</p>
    {item.detail !== "" && (
      <p className="text-xs text-ink-muted truncate">{item.detail}</p>
    )}
    {item.agentName !== null && (
      <p className="text-[10px] text-ink-soft mt-0.5">{item.agentName}</p>
    )}
  </Link>
);

export const Briefing: FC = () => {
  const { t } = useTranslation();
  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const briefing = useBriefingStore((s) => s.briefing);
  const loading = useBriefingStore((s) => s.loading);
  const error = useBriefingStore((s) => s.error);
  const load = useBriefingStore((s) => s.load);
  const markReviewed = useBriefingStore((s) => s.markReviewed);
  const [othersExpanded, setOthersExpanded] = useState(false);

  useEffect(() => {
    if (activeCompanyId !== null) void load(activeCompanyId);
  }, [activeCompanyId, load]);

  if (activeCompanyId === null) {
    return (
      <div className="p-8">
        <p className="text-sm text-ink-muted">{t("briefing.noCompany")}</p>
      </div>
    );
  }

  if (loading && briefing === null) {
    return (
      <div className="p-8">
        <p className="text-sm text-ink-muted">{t("briefing.loading")}</p>
      </div>
    );
  }

  if (error !== null && briefing === null) {
    return (
      <div className="p-8">
        <p role="alert" className="text-sm text-semantic-danger">
          {error}
        </p>
      </div>
    );
  }

  if (briefing === null) return null;

  const otherCount =
    briefing.verified.length +
    briefing.failed.length +
    briefing.inProgress.length +
    briefing.learned.length;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      {/* Headline */}
      <header>
        <h1 className="text-2xl font-bold text-brand-dark">{t("briefing.title")}</h1>
        <p className="mt-1 text-sm text-ink">{briefing.headline}</p>
      </header>

      {/* Precisa de você — always at top */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-brand-dark">
            {t("briefing.needsYou")} ({briefing.needsYou.length})
          </h2>
          <button
            type="button"
            onClick={() => void markReviewed(activeCompanyId)}
            className="text-xs px-2 py-1 bg-surface-soft text-ink-muted rounded hover:bg-surface-border"
          >
            {t("briefing.markReviewed")}
          </button>
        </div>
        {briefing.needsYou.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("briefing.needsYouEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {briefing.needsYou.map((item) => (
              <li key={item.id}>
                <ItemRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Other buckets — colapsável */}
      <section>
        <button
          type="button"
          onClick={() => setOthersExpanded((v) => !v)}
          className="text-xs text-ink-muted hover:text-ink"
        >
          {othersExpanded ? t("briefing.othersHide") : t("briefing.othersShow", { count: otherCount })}
        </button>
        {othersExpanded && (
          <div className="mt-3 space-y-4">
            {briefing.verified.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-semantic-success mb-1">
                  {t("briefing.verified")} ({briefing.verified.length})
                </h3>
                <ul className="space-y-1">
                  {briefing.verified.map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {briefing.failed.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-semantic-danger mb-1">
                  {t("briefing.failed")} ({briefing.failed.length})
                </h3>
                <ul className="space-y-1">
                  {briefing.failed.map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {briefing.inProgress.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-brand mb-1">
                  {t("briefing.inProgress")} ({briefing.inProgress.length})
                </h3>
                <ul className="space-y-1">
                  {briefing.inProgress.map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {briefing.learned.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">
                  {t("briefing.learned")} ({briefing.learned.length})
                </h3>
                <ul className="space-y-1">
                  {briefing.learned.map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Cost footer */}
      <footer className="text-xs text-ink-muted pt-4 border-t border-surface-border">
        {t("briefing.costFooter", { cost: formatCents(briefing.costCents) })}
      </footer>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/routes/Briefing.tsx
git commit -m "feat(briefing): add Briefing route component"
```

---

## Task 9: Wire Briefing as the landing route + sidebar nav

**Files:**
- Modify: `apps/renderer/src/App.tsx`
- Modify: `apps/renderer/src/i18n/en-US.json` + `pt-BR.json`

> Read `apps/renderer/src/App.tsx` around the routes (lines 327-547). The Dashboard route stays as `/dashboard`. We add `/briefing`, change the wildcard's redirect target, and prepend a sidebar NavLink.

- [ ] **Step 1: Add the i18n keys**

In `apps/renderer/src/i18n/en-US.json`, extend `nav` and add a new top-level `briefing`:

```json
"nav": {
  ...existing keys...,
  "briefing": "Briefing"
},
...,
"briefing": {
  "title": "Morning briefing",
  "loading": "Loading briefing…",
  "noCompany": "Select a company to see the briefing.",
  "needsYou": "Needs you",
  "needsYouEmpty": "Nothing waiting on you — clear morning.",
  "markReviewed": "Mark as reviewed",
  "verified": "Delivered",
  "failed": "Failed",
  "inProgress": "In progress",
  "learned": "Learned",
  "othersShow": "Show the rest ({{count}})",
  "othersHide": "Hide",
  "costFooter": "Spent overnight: {{cost}}"
}
```

In `apps/renderer/src/i18n/pt-BR.json`, mirror with Portuguese:

```json
"nav": {
  ...existing keys...,
  "briefing": "Briefing"
},
...,
"briefing": {
  "title": "Vitrine matinal",
  "loading": "Carregando briefing…",
  "noCompany": "Selecione uma empresa pra ver o briefing.",
  "needsYou": "Precisa de você",
  "needsYouEmpty": "Nada esperando você — manhã tranquila.",
  "markReviewed": "Marcar como revisado",
  "verified": "Entregues",
  "failed": "Falharam",
  "inProgress": "Em andamento",
  "learned": "Aprendeu",
  "othersShow": "Mostrar o resto ({{count}})",
  "othersHide": "Esconder",
  "costFooter": "Gasto durante a noite: {{cost}}"
}
```

- [ ] **Step 2: Add the route and sidebar NavLink**

In `apps/renderer/src/App.tsx`:

1. Add the import:

```typescript
import { Briefing } from "./routes/Briefing.js";
```

2. Add the route (alongside the other top-level routes; place it before `/dashboard` for prominence):

```tsx
<Route
  path="/briefing"
  element={
    hasToken ? (
      <Layout>
        <Briefing />
      </Layout>
    ) : (
      <Navigate to="/setup" replace />
    )
  }
/>
```

3. Change the wildcard target — find the line `path="*" element={<Navigate to={hasToken ? "/dashboard" : "/setup"} replace />}` and change `/dashboard` to `/briefing`.

4. Add the NavLink. In the sidebar nav (around line 59-67 where `/dashboard` is), prepend:

```tsx
<NavLink
  to="/briefing"
  className={({ isActive }) =>
    `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
  }
>
  {t("nav.briefing")}
</NavLink>
```

5. Update the `/setup`-success redirect (line 332): change `<Navigate to="/dashboard" replace />` to `<Navigate to="/briefing" replace />`.

- [ ] **Step 3: Typecheck + parity**

Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/renderer test parity`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/App.tsx apps/renderer/src/i18n
git commit -m "feat(briefing): make briefing the landing route"
```

---

## Task 10: Full verification + non-regression

**Files:** none (verification only).

- [ ] **Step 1: Whole-monorepo typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Whole-monorepo lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Whole-monorepo tests**

Run: `pnpm test`
Expected: green. Baseline going in is 1625 + 2 todo. PR-C adds:
- 0034 migration test: 2 cases
- briefing/build test: 6 cases
- briefing/headline test: 5 cases
- briefing-handlers test: 3 cases

Expected delta: **+16 tests**, total ~**1641** + 2 todo. Note the actual number for the handoff.

- [ ] **Step 4: IPC channels sanity**

Run: `pnpm --filter @prospero/shared test ipc-channels`
Expected: 12 cases pass (the test asserts uniqueness + casing, not count — adding 2 channels does not break it).

- [ ] **Step 5: Token efficiency confirmation**

PR-C touches the orchestrator zero times. Confirm:

```
grep -rn "buildBriefing\|generateBriefingHeadline\|briefing:get\|briefing:mark-reviewed\|briefing_reviewed_at" apps/main/src/orchestrator/
```

Expected: empty. The headline is generated **outside** any agent's prompt — it's a per-user-action call, not per-agent-turn.

- [ ] **Step 6: Live smoke (PENDING — list for the human)**

`claude -p` headless has not run live in this environment (M11 PR-D1 carry-over). The renderer will show the deterministic fallback headline. In the final report, list:

1. Launch the app. Confirm the wildcard redirects to `/briefing`, not `/dashboard`.
2. Confirm the "Briefing" NavLink is first in the sidebar.
3. With an active company that has no recent activity, confirm "Precisa de você — Nada esperando você." and a fallback headline like "Quiet night."
4. Create an approval / verification_failed inbox item. Reload. Confirm it appears in "Precisa de você" and the headline regenerates (or falls back).
5. Click "Mark as reviewed". Confirm the cursor advances and the buckets refresh.
6. Open `/dashboard` directly — confirm it still works (just not the default landing).

- [ ] **Step 7: Optional cleanup commit (only if Step 1 or 2 surfaced fixes)**

If a type literal or count assertion needed touching:

```bash
git add -A
git commit -m "test(briefing): update mock fixtures"
```

Otherwise skip — Task 10 is a checkpoint.

---

## Self-Review (completed by plan author)

**Spec coverage (§5 + §9 + §11 row C):**

- §5.1 (modelo C — manchete IA + blocos estruturados; postura de triagem) → Tasks 5 + 8 ✓
- §5.2 (Precisa de você + Verificados + Falhou + Em andamento + Aprendeu + Custo + fontes) → Task 4 ✓
- §5.3 (`Briefing` + `BriefingItem` types, `buildBriefing(companyId, sinceTs)`) → Tasks 2 + 4 ✓
- §5.4 (manchete cacheada por hash, custo gravado em `cost_events` com `adapter_name='briefing-headline'`, degradação graciosa) → Task 5 ✓
- §5.5 (cursor `companies.briefing_reviewed_at`, botão "Marcar como revisado", janela default 24h) → Tasks 1 + 3 + 4 + 6 + 8 ✓
- §5.6 (vira a rota inicial; Dashboard continua acessível) → Task 9 ✓
- §9 (IPC `briefing:get` + `briefing:mark-reviewed`; sem MCP tools) → Task 6 ✓
- §11 row C scope → covered ✓

**Placeholder scan:** every code-changing step has code. Five adapt-points flagged: Task 3 Step 1 (confirm explicit SELECT column lists in `companies/repository.ts`), Task 4 Step 2 (verify `issues.assignee_agent_id` and `cost_events.cost_cents_estimate` column names against migrations), Task 6 Step 6 (confirm `Briefing` type name flows through the preload bridge identically), Task 9 Step 2 (re-confirm the exact wildcard route line in `App.tsx`). All are "find this; mirror it", not "TBD".

**Type consistency:** `Briefing` and `BriefingItem` defined in Task 2; consumed in Tasks 4 (build), 5 (counters via `BriefingCounters`), 6 (handler), 7 (store), 8 (route). `Company.briefingReviewedAt` defined in Task 2; consumed in Task 3 (repo) and Task 6 (handler). `BriefingCounters` defined in Task 5; consumed in Task 6 (handler stitches counters from `Briefing` arrays into `BriefingCounters`).

**Token efficiency:** zero impact on any agent system prompt (Task 10 Step 5 verifies). The headline is one `claude -p` call **per user action**, cached by hash of the counters — opening the Vitrine repeatedly costs zero new calls in the same state. Cost recorded under `adapter_name='briefing-headline'` so it's visible in the existing Costs UI.

**Security:** the Vitrine is a read-only triage view. No write surface beyond the cursor (`briefing:mark-reviewed` only updates `companies.briefing_reviewed_at`). The headline is generated from non-sensitive aggregate counters (six small integers) — no leak of agent data into the prompt.
