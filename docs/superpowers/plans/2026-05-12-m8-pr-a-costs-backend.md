# M8 PR-A — Costs Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Token tracking real (capture + persist + estimate cost cents + soft-stop on budget overrun) wired end-to-end into the orchestrator, with 4 IPC handlers exposing aggregated data and budget settings.

**Architecture:** Stream-parser extracts `usage` from `claude -p` `result` events. `costRecorder` writes 1 row per turn-complete to new `cost_events` table; pricing snapshotted as `cost_cents_estimate`. Lifecycle hook calls `enforceBudget.checkAndPause` after each turn — pause agent + Inbox security_alert when daily/per-issue cap exceeded (reuses M7.6 `enqueueOrPark`). Day-summary activity event written lazily on first turn of the next day (avoids per-turn volume).

**Tech Stack:** TypeScript, better-sqlite3, Zod, vitest. Spec: [docs/superpowers/specs/2026-05-12-m8-costs-design.md](../specs/2026-05-12-m8-costs-design.md).

**Out of scope (PR-B):** `/costs` route, Dashboard widget, StatsTab real, Settings UI for budgets, ModelDropdown hints, recharts dep.

---

## File map

**Create:**
- `apps/main/src/db/migrations/0011_cost_events.sql`
- `apps/main/src/costs/pricing.ts`
- `apps/main/src/costs/repository.ts`
- `apps/main/src/costs/recorder.ts`
- `apps/main/src/costs/budgets-repository.ts`
- `apps/main/src/costs/enforce-budget.ts`
- `apps/main/src/costs/day-summary.ts`
- `apps/main/tests/db.migration-0011.test.ts`
- `apps/main/tests/costs.pricing.test.ts`
- `apps/main/tests/costs.repository.test.ts`
- `apps/main/tests/costs.recorder.test.ts`
- `apps/main/tests/costs.budgets-repository.test.ts`
- `apps/main/tests/costs.enforce-budget.test.ts`
- `apps/main/tests/costs.day-summary.test.ts`
- `apps/main/tests/ipc.costs-handlers.test.ts`

**Modify:**
- `packages/shared/src/types/adapter.ts` — extend `ParsedEvent` `turn-complete` with `usage?`/`model?`
- `packages/shared/src/types/costs.ts` (new file inside packages/shared) — `CostEventRow`, `CostBudgets`, `CostBucket`, `AgentTotal`, `ProjectTotal`, `CostsQueryInput`, `CostsAggregateToday`
- `packages/shared/src/index.ts` — re-export new costs types
- `packages/shared/src/ipc-channels.ts` — 4 new channels + `COSTS_NEW` broadcast
- `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts` — `safeReadUsage` + return usage+model in `turn-complete`
- `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts` — populate `this.usage` from turn-complete events
- `apps/main/tests/orchestrator.stream-parser.test.ts` — add 4 cases for usage parsing
- `apps/main/tests/orchestrator.adapter.test.ts` — assert usage accumulation
- `apps/main/src/ipc/orchestrator-handlers.ts` — call recorder/enforce in the existing `turn-complete` branch + register 4 new IPC handlers + broadcast `costs:new` debounced

**Reuse (no edits):**
- `apps/main/src/activity/recorder.ts` — `recordActivity({ action: 'cost.day_summary' })` (schema already exists)
- `apps/main/src/inbox/repository.ts` — `inbox.create({ kind: 'security_alert' })`
- `apps/main/src/agents/repository.ts` — `pauseAgent(id, reason)` (M7.6)
- `apps/main/src/orchestrator/router.ts` — `enqueueOrPark` (M7.6 backlog parking)

---

## Task 1: Migration 0011 — `cost_events` table + budget settings seed

**Files:**
- Create: `apps/main/src/db/migrations/0011_cost_events.sql`
- Create: `apps/main/tests/db.migration-0011.test.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
// apps/main/tests/db.migration-0011.test.ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; notnull: number };

describe("migration 0011 — cost_events table + budget settings seed", () => {
  it("drops legacy costs_log table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='costs_log'")
      .get() as { name: string } | undefined;
    expect(row).toBeUndefined();
  });

  it("creates cost_events with all expected columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = db.pragma("table_info(cost_events)") as ColumnInfo[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "company_id",
        "agent_id",
        "project_id",
        "issue_id",
        "adapter_name",
        "model",
        "session_id",
        "input_tokens",
        "output_tokens",
        "cache_creation_tokens",
        "cache_read_tokens",
        "cost_cents_estimate",
        "occurred_at",
      ]),
    );
  });

  it("creates the 5 cost_events indexes", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = (db.pragma("index_list(cost_events)") as Array<{ name: string }>).map(
      (i) => i.name,
    );
    expect(idx).toContain("idx_cost_events_company_day");
    expect(idx).toContain("idx_cost_events_agent_day");
    expect(idx).toContain("idx_cost_events_project");
    expect(idx).toContain("idx_cost_events_adapter");
    expect(idx).toContain("idx_cost_events_issue");
  });

  it("seeds 4 budget.* settings keys with defaults", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'budget.%' ORDER BY key")
      .all() as Array<{ key: string; value: string }>;
    expect(rows).toEqual([
      { key: "budget.max_tokens_per_day_per_agent", value: "2000000" },
      { key: "budget.max_tokens_per_issue", value: "200000" },
      { key: "budget.rate_limit_window_hours", value: "5" },
      { key: "budget.rate_limit_window_tokens", value: "1000000" },
    ]);
  });
});
```

- [ ] **Step 2: Run the test — expect failure (no migration yet)**

Run: `pnpm --filter @prospero/main test db.migration-0011`
Expected: FAIL — `costs_log` still exists OR `cost_events` does not exist.

- [ ] **Step 3: Create the migration SQL**

```sql
-- apps/main/src/db/migrations/0011_cost_events.sql
-- M8 PR-A: cost tracking foundation.
--
-- Drops the legacy costs_log table (declared in 0001 but never written) and
-- replaces it with cost_events — adapter-aware, with issue_id linkage for
-- per-issue budget enforcement, and cost_cents_estimate snapshotted at insert
-- so future pricing changes don't invalidate historical rows.
--
-- Seeds 4 budget.* settings keys (flat KV, not the app-settings JSON blob)
-- so each cap can be read/written independently by costs:get/set-budgets IPC.
--
-- defer_foreign_keys (lesson learned from 0010 fix 79e618a): even though we
-- DROP costs_log (no children) this migration ships in the same release as
-- future ones; staying explicit costs nothing.

PRAGMA defer_foreign_keys = 1;

DROP INDEX IF EXISTS idx_costs_company_date;
DROP TABLE IF EXISTS costs_log;

CREATE TABLE cost_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  adapter_name TEXT NOT NULL,
  model TEXT,
  session_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents_estimate INTEGER NOT NULL DEFAULT 0,
  occurred_at INTEGER NOT NULL
);

CREATE INDEX idx_cost_events_company_day ON cost_events(company_id, occurred_at);
CREATE INDEX idx_cost_events_agent_day   ON cost_events(agent_id, occurred_at);
CREATE INDEX idx_cost_events_project     ON cost_events(project_id);
CREATE INDEX idx_cost_events_adapter     ON cost_events(adapter_name, occurred_at);
CREATE INDEX idx_cost_events_issue       ON cost_events(issue_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('budget.max_tokens_per_day_per_agent', '2000000'),
  ('budget.max_tokens_per_issue',         '200000'),
  ('budget.rate_limit_window_tokens',     '1000000'),
  ('budget.rate_limit_window_hours',      '5');
```

- [ ] **Step 4: Run the test — expect pass**

Run: `pnpm --filter @prospero/main test db.migration-0011`
Expected: PASS — 4 cases green.

- [ ] **Step 5: Run the full migration suite to confirm no regression**

Run: `pnpm --filter @prospero/main test db.migration`
Expected: PASS — all migration tests (0002–0011) green.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/db/migrations/0011_cost_events.sql apps/main/tests/db.migration-0011.test.ts
git commit -m "feat(m8): migration 0011 cost_events + budget defaults"
```

---

## Task 2: Extend `ParsedEvent` type with usage on `turn-complete`

**Files:**
- Modify: `packages/shared/src/types/adapter.ts`

- [ ] **Step 1: Update the `ParsedEvent` type**

In `packages/shared/src/types/adapter.ts`, replace the `turn-complete` variant:

```ts
export type ParsedEvent =
  | { kind: "session-init"; sessionId: string }
  | { kind: "assistant-message"; blocks: AssistantContentBlock[] }
  | { kind: "tool-result"; toolUseId: string; content: string; isError: boolean }
  | { kind: "turn-complete"; usage?: UsageEstimate; model?: string }
  | { kind: "api-retry"; attempt: number; error: string }
  | { kind: "unknown"; raw: unknown };
```

- [ ] **Step 2: Build shared package**

Run: `pnpm --filter @prospero/shared build`
Expected: success.

- [ ] **Step 3: Run typecheck across main + renderer**

Run: `pnpm typecheck`
Expected: PASS. Existing `turn-complete` consumers use property access without destructuring usage/model, so the optional fields don't break them. If any consumer narrows incorrectly, fix in this task.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/adapter.ts
git commit -m "feat(m8): extend turn-complete ParsedEvent with usage + model"
```

---

## Task 3: Stream-parser — `safeReadUsage` + emit usage on turn-complete

**Files:**
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts`
- Modify: `apps/main/tests/orchestrator.stream-parser.test.ts`

- [ ] **Step 1: Add failing tests for usage parsing**

Append to `apps/main/tests/orchestrator.stream-parser.test.ts`:

```ts
describe("parseStreamLine — result event with usage (M8)", () => {
  it("parses usage object on result event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 200,
      },
      message: { model: "claude-sonnet-4-6" },
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("turn-complete");
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toEqual({
        input: 100,
        output: 50,
        cache_creation: 1000,
        cache_read: 200,
      });
      expect(parsed.model).toBe("claude-sonnet-4-6");
    }
  });

  it("returns usage undefined when result event has no usage", () => {
    const line = JSON.stringify({ type: "result", subtype: "success" });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("turn-complete");
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toBeUndefined();
      expect(parsed.model).toBeUndefined();
    }
  });

  it("tolerates partial usage (missing cache fields)", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { input_tokens: 42, output_tokens: 17 },
    });
    const parsed = parseStreamLine(line);
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toEqual({
        input: 42,
        output: 17,
        cache_creation: 0,
        cache_read: 0,
      });
    }
  });

  it("returns usage undefined when all token counts are zero or missing", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const parsed = parseStreamLine(line);
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toBeUndefined();
    }
  });

  it("ignores negative token values (defaults to 0)", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { input_tokens: -5, output_tokens: 10 },
    });
    const parsed = parseStreamLine(line);
    if (parsed?.kind === "turn-complete") {
      expect(parsed.usage).toEqual({
        input: 0,
        output: 10,
        cache_creation: 0,
        cache_read: 0,
      });
    }
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test orchestrator.stream-parser`
Expected: 5 FAILs in the M8 describe block.

- [ ] **Step 3: Implement `safeReadUsage` + update `result` branch**

Replace the `result` branch in `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts`:

```ts
// result — turn completed
if (data["type"] === "result") {
  const usage = safeReadUsage(data["usage"]);
  const model = readModel(data);
  return { kind: "turn-complete", usage, model };
}
```

Add helpers (place above `parseStreamLine`):

```ts
const safeReadUsage = (raw: unknown): UsageEstimate | undefined => {
  if (!isObject(raw)) return undefined;
  const n = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  const result: UsageEstimate = {
    input: n(raw["input_tokens"]),
    output: n(raw["output_tokens"]),
    cache_creation: n(raw["cache_creation_input_tokens"]),
    cache_read: n(raw["cache_read_input_tokens"]),
  };
  const total =
    result.input + result.output + result.cache_creation + result.cache_read;
  return total > 0 ? result : undefined;
};

const readModel = (data: Record<string, unknown>): string | undefined => {
  if (typeof data["model"] === "string") return data["model"];
  if (isObject(data["message"]) && typeof data["message"]["model"] === "string") {
    return data["message"]["model"];
  }
  return undefined;
};
```

Add `UsageEstimate` to the import line at the top:

```ts
import type { AssistantContentBlock, ParsedEvent, UsageEstimate } from "@prospero/shared";
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test orchestrator.stream-parser`
Expected: all PASS (including the 4 existing test groups + 5 new M8 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts apps/main/tests/orchestrator.stream-parser.test.ts
git commit -m "feat(m8): stream-parser captures usage + model on result event"
```

---

## Task 4: Adapter — accumulate `usage` from turn-complete events

**Files:**
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts`
- Modify: `apps/main/tests/orchestrator.adapter.test.ts`

- [ ] **Step 1: Add failing test for usage accumulation**

Append to `apps/main/tests/orchestrator.adapter.test.ts`. Use the existing test setup (FakeClaude or unit test on the parsed-event handler). If the existing file does not exercise turn-complete handling, add a focused test that directly invokes the private `emitEvent` path via a public surface. Concrete pattern (extending existing setup):

```ts
import { describe, expect, it } from "vitest";
import { ClaudeOAuthLocalAdapter } from "../src/orchestrator/adapters/claude-oauth-local/adapter.js";
import type { SpawnContext } from "@prospero/shared";

describe("ClaudeOAuthLocalAdapter — usage accumulation (M8)", () => {
  const makeCtx = (): SpawnContext => ({
    agent: {
      id: "agent_x",
      companyId: "co_1",
      name: "Test",
      role: "Engineer",
      systemPrompt: "",
      skills: [],
      allowedProjects: [],
      mode: "supervised",
      alwaysOn: false,
      reportsTo: null,
      claudeSessionId: null,
      status: "idle",
      currentAction: null,
      model: "claude-sonnet-4-6",
      adapterName: "claude-oauth-local",
      pausedAt: null,
      terminatedAt: null,
      pauseReason: null,
      createdAt: 0,
      updatedAt: 0,
    },
    oauthToken: "tk",
    dbPath: ":memory:",
    permissionsDir: "/tmp/p",
    eventsDir: "/tmp/e",
  });

  it("returns zeros before any turn-complete arrives", () => {
    const adapter = new ClaudeOAuthLocalAdapter(makeCtx());
    expect(adapter.getUsage()).toEqual({
      input: 0,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
  });

  it("accumulates usage across multiple turn-complete events", () => {
    const adapter = new ClaudeOAuthLocalAdapter(makeCtx());
    // Access the internal emitter via the public onEvent listener pipeline.
    // The adapter listens to its own parsed stream via emitEvent; we drive that
    // by inlining a helper on the prototype is not exposed — so we exercise
    // the parser-to-state hook by reaching the same private method via cast.
    const internal = adapter as unknown as {
      handleParsedEvent: (e: import("@prospero/shared").ParsedEvent) => void;
    };
    internal.handleParsedEvent({
      kind: "turn-complete",
      usage: { input: 10, output: 5, cache_creation: 100, cache_read: 20 },
      model: "claude-sonnet-4-6",
    });
    internal.handleParsedEvent({
      kind: "turn-complete",
      usage: { input: 7, output: 3, cache_creation: 0, cache_read: 5 },
    });
    expect(adapter.getUsage()).toEqual({
      input: 17,
      output: 8,
      cache_creation: 100,
      cache_read: 25,
    });
  });

  it("ignores turn-complete events with no usage", () => {
    const adapter = new ClaudeOAuthLocalAdapter(makeCtx());
    const internal = adapter as unknown as {
      handleParsedEvent: (e: import("@prospero/shared").ParsedEvent) => void;
    };
    internal.handleParsedEvent({ kind: "turn-complete" });
    expect(adapter.getUsage()).toEqual({
      input: 0,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test orchestrator.adapter`
Expected: FAIL — `handleParsedEvent` does not exist yet OR usage stays at zero.

- [ ] **Step 3: Refactor `adapter.ts` to centralize parsed-event handling**

In `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts`, replace the inline `rl.on("line", ...)` callback to route through a new `handleParsedEvent` method. Locate the existing block (around line 114):

```ts
if (this.child.stdout !== null) {
  const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const preview = line.length > 300 ? line.slice(0, 300) + "..." : line;
    dlog(`stdout: ${preview}`);
    const parsed = parseStreamLine(line);
    if (parsed !== null) this.emitEvent(parsed);
  });
}
```

Replace with:

```ts
if (this.child.stdout !== null) {
  const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const preview = line.length > 300 ? line.slice(0, 300) + "..." : line;
    dlog(`stdout: ${preview}`);
    const parsed = parseStreamLine(line);
    if (parsed !== null) this.handleParsedEvent(parsed);
  });
}
```

Add the new method below `emitEvent`:

```ts
private handleParsedEvent(event: ParsedEvent): void {
  if (event.kind === "turn-complete" && event.usage !== undefined) {
    this.usage.input += event.usage.input;
    this.usage.output += event.usage.output;
    this.usage.cache_creation += event.usage.cache_creation;
    this.usage.cache_read += event.usage.cache_read;
  }
  this.emitEvent(event);
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test orchestrator.adapter`
Expected: 3 new M8 cases PASS + all prior cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts apps/main/tests/orchestrator.adapter.test.ts
git commit -m "feat(m8): adapter accumulates usage from turn-complete events"
```

---

## Task 5: Pricing table + `estimateCostCents`

**Files:**
- Create: `apps/main/src/costs/pricing.ts`
- Create: `apps/main/tests/costs.pricing.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/main/tests/costs.pricing.test.ts
import { describe, expect, it } from "vitest";
import { estimateCostCents, MODEL_PRICING } from "../src/costs/pricing.js";

describe("estimateCostCents", () => {
  it("returns 0 for unknown model", () => {
    expect(
      estimateCostCents("not-a-model", {
        input: 1000,
        output: 500,
        cache_creation: 0,
        cache_read: 0,
      }),
    ).toBe(0);
  });

  it("returns 0 for undefined model", () => {
    expect(
      estimateCostCents(undefined, {
        input: 1000,
        output: 500,
        cache_creation: 0,
        cache_read: 0,
      }),
    ).toBe(0);
  });

  it("estimates sonnet 4.6 cost correctly", () => {
    // 1M input tokens at 300 cents/MTok = 300 cents
    // 1M output tokens at 1500 cents/MTok = 1500 cents
    const cents = estimateCostCents("claude-sonnet-4-6", {
      input: 1_000_000,
      output: 1_000_000,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(1800);
  });

  it("estimates opus 4.7 cost correctly", () => {
    const cents = estimateCostCents("claude-opus-4-7", {
      input: 1_000_000,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(1500);
  });

  it("includes cache creation + cache read tokens", () => {
    // sonnet: cacheCreate 375, cacheRead 30 cents/MTok
    const cents = estimateCostCents("claude-sonnet-4-6", {
      input: 0,
      output: 0,
      cache_creation: 1_000_000,
      cache_read: 1_000_000,
    });
    expect(cents).toBe(375 + 30);
  });

  it("ceils sub-cent totals (never rounds down to 0)", () => {
    // 1 token of haiku input at 100 cents/MTok = 0.0001 cents — should ceil to 1
    const cents = estimateCostCents("claude-haiku-4-5-20251001", {
      input: 1,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(1);
  });

  it("returns 0 when usage is all zero (no ceil)", () => {
    const cents = estimateCostCents("claude-sonnet-4-6", {
      input: 0,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
    });
    expect(cents).toBe(0);
  });

  it("MODEL_PRICING covers opus/sonnet/haiku 4.x", () => {
    expect(MODEL_PRICING["claude-opus-4-7"]).toBeDefined();
    expect(MODEL_PRICING["claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-haiku-4-5-20251001"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test costs.pricing`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement pricing module**

```ts
// apps/main/src/costs/pricing.ts
// Pricing snapshot taken 2026-05-12 from Anthropic's public pricing page.
// Values are USD cents per 1M tokens, INTEGER (no fractional cents) to keep
// math exact in better-sqlite3. Re-validate on each release; the snapshotted
// cost_cents_estimate in cost_events.row preserves history if prices change.
//
// Source numbers (USD per 1M tokens):
//   Opus 4.7    — input $15.00, output $75.00, cacheCreate $18.75, cacheRead $1.50
//   Sonnet 4.6  — input  $3.00, output $15.00, cacheCreate  $3.75, cacheRead $0.30
//   Haiku 4.5   — input  $1.00, output  $5.00, cacheCreate  $1.25, cacheRead $0.10
// Multiplied by 100 → cents per 1M tokens (the units of the table below).

import type { UsageEstimate } from "@prospero/shared";

export type ModelPricing = {
  in: number;
  out: number;
  cacheCreate: number;
  cacheRead: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": { in: 1500, out: 7500, cacheCreate: 1875, cacheRead: 150 },
  "claude-sonnet-4-6": { in: 300, out: 1500, cacheCreate: 375, cacheRead: 30 },
  "claude-haiku-4-5-20251001": { in: 100, out: 500, cacheCreate: 125, cacheRead: 10 },
};

export const estimateCostCents = (
  model: string | undefined,
  usage: UsageEstimate,
): number => {
  if (model === undefined) return 0;
  const p = MODEL_PRICING[model];
  if (p === undefined) return 0;
  const microCents =
    usage.input * p.in +
    usage.output * p.out +
    usage.cache_creation * p.cacheCreate +
    usage.cache_read * p.cacheRead;
  if (microCents === 0) return 0;
  return Math.ceil(microCents / 1_000_000);
};
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test costs.pricing`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/costs/pricing.ts apps/main/tests/costs.pricing.test.ts
git commit -m "feat(m8): pricing table + estimateCostCents"
```

---

## Task 6: Cost repository — insert + queries

**Files:**
- Create: `apps/main/src/costs/repository.ts`
- Create: `apps/main/tests/costs.repository.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/main/tests/costs.repository.test.ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createCostsRepository } from "../src/costs/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const company = companies.create({ name: "Acme" });
  const repo = createCostsRepository(db);
  return { db, companyId: company.id, repo };
};

describe("costs repository", () => {
  it("inserts a cost_event row and returns it", () => {
    const { repo, companyId } = setup();
    const row = repo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: "sess_1",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 1,
      occurredAt: 1_700_000_000_000,
    });
    expect(row.id.startsWith("cost_")).toBe(true);
    expect(row.inputTokens).toBe(100);
    expect(row.costCentsEstimate).toBe(1);
  });

  it("getAgentDailyTotal sums tokens + cents for the given day (UTC)", () => {
    const { repo, companyId } = setup();
    const day = new Date("2026-05-12T12:00:00Z");
    const sameDay = day.getTime();
    const nextDay = new Date("2026-05-13T01:00:00Z").getTime();
    repo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 5,
      occurredAt: sameDay,
    });
    repo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 50,
      outputTokens: 25,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 2,
      occurredAt: sameDay + 3600_000,
    });
    repo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 999,
      outputTokens: 999,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 50,
      occurredAt: nextDay,
    });
    const total = repo.getAgentDailyTotal("agent_x", day);
    expect(total.tokens).toBe(100 + 200 + 50 + 25);
    expect(total.cents).toBe(7);
  });

  it("getIssueTotal sums all rows tied to an issue across time", () => {
    const { repo, companyId } = setup();
    repo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: "iss_1",
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 10,
      occurredAt: 1_700_000_000_000,
    });
    repo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: "iss_1",
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 500,
      outputTokens: 250,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 5,
      occurredAt: 1_700_100_000_000,
    });
    repo.insert({
      companyId,
      agentId: "agent_y",
      projectId: null,
      issueId: "iss_2",
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 9999,
      outputTokens: 9999,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 999,
      occurredAt: 1_700_200_000_000,
    });
    const total = repo.getIssueTotal("iss_1");
    expect(total.tokens).toBe(1000 + 500 + 500 + 250);
    expect(total.cents).toBe(15);
  });

  it("getAgentDailyTotal returns zeros for an agent with no rows", () => {
    const { repo } = setup();
    const total = repo.getAgentDailyTotal("agent_nobody", new Date());
    expect(total.tokens).toBe(0);
    expect(total.cents).toBe(0);
  });

  it("hasAgentRowsForDay returns true only when at least one row exists for that UTC day", () => {
    const { repo, companyId } = setup();
    const day = new Date("2026-05-11T15:00:00Z");
    expect(repo.hasAgentRowsForDay("agent_x", day)).toBe(false);
    repo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 1,
      outputTokens: 1,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 1,
      occurredAt: day.getTime(),
    });
    expect(repo.hasAgentRowsForDay("agent_x", day)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test costs.repository`
Expected: FAIL — module not implemented.

- [ ] **Step 3: Implement the repository**

```ts
// apps/main/src/costs/repository.ts
// Read/write surface for the cost_events table.
// All time math is UTC (midnight-to-midnight on the calendar day in UTC).
// The day boundary matches what the user sees in /costs charts; renderer
// localizes display but bucketing stays canonical.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type CostEventInsert = {
  companyId: string;
  agentId: string | null;
  projectId: string | null;
  issueId: string | null;
  adapterName: string;
  model: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costCentsEstimate: number;
  occurredAt: number;
};

export type CostEventRow = CostEventInsert & { id: string };

export type CostTotal = { tokens: number; cents: number };

export type CostsRepository = {
  insert(input: CostEventInsert): CostEventRow;
  getAgentDailyTotal(agentId: string, day: Date): CostTotal;
  getIssueTotal(issueId: string): CostTotal;
  hasAgentRowsForDay(agentId: string, day: Date): boolean;
};

const utcDayBounds = (day: Date): { start: number; end: number } => {
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return { start, end: start + 86_400_000 };
};

const totalTokens = (row: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}): number =>
  row.input_tokens + row.output_tokens + row.cache_creation_tokens + row.cache_read_tokens;

export const createCostsRepository = (db: Database.Database): CostsRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO cost_events (
      id, company_id, agent_id, project_id, issue_id, adapter_name, model, session_id,
      input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
      cost_cents_estimate, occurred_at
    ) VALUES (
      @id, @companyId, @agentId, @projectId, @issueId, @adapterName, @model, @sessionId,
      @inputTokens, @outputTokens, @cacheCreationTokens, @cacheReadTokens,
      @costCentsEstimate, @occurredAt
    )
  `);

  const sumAgentDayStmt = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cost_cents_estimate), 0) AS cost_cents_estimate
    FROM cost_events
    WHERE agent_id = ? AND occurred_at >= ? AND occurred_at < ?
  `);

  const sumIssueStmt = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cost_cents_estimate), 0) AS cost_cents_estimate
    FROM cost_events
    WHERE issue_id = ?
  `);

  const hasAgentDayStmt = db.prepare(`
    SELECT 1 AS hit
    FROM cost_events
    WHERE agent_id = ? AND occurred_at >= ? AND occurred_at < ?
    LIMIT 1
  `);

  const insert = (input: CostEventInsert): CostEventRow => {
    const id = `cost_${randomUUID()}`;
    insertStmt.run({ id, ...input });
    return { id, ...input };
  };

  const getAgentDailyTotal = (agentId: string, day: Date): CostTotal => {
    const { start, end } = utcDayBounds(day);
    const row = sumAgentDayStmt.get(agentId, start, end) as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_cents_estimate: number;
    };
    return { tokens: totalTokens(row), cents: row.cost_cents_estimate };
  };

  const getIssueTotal = (issueId: string): CostTotal => {
    const row = sumIssueStmt.get(issueId) as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_cents_estimate: number;
    };
    return { tokens: totalTokens(row), cents: row.cost_cents_estimate };
  };

  const hasAgentRowsForDay = (agentId: string, day: Date): boolean => {
    const { start, end } = utcDayBounds(day);
    const row = hasAgentDayStmt.get(agentId, start, end) as { hit: number } | undefined;
    return row !== undefined;
  };

  return { insert, getAgentDailyTotal, getIssueTotal, hasAgentRowsForDay };
};
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test costs.repository`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/costs/repository.ts apps/main/tests/costs.repository.test.ts
git commit -m "feat(m8): cost_events repository (insert + daily/issue totals)"
```

---

## Task 7: Cost recorder — orchestrates pricing + repository + broadcast

**Files:**
- Create: `apps/main/src/costs/recorder.ts`
- Create: `apps/main/tests/costs.recorder.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/main/tests/costs.recorder.test.ts
import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createCostsRepository } from "../src/costs/repository.js";
import { createCostRecorder } from "../src/costs/recorder.js";
import type { CostsBroadcast } from "../src/costs/recorder.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const company = companies.create({ name: "Acme" });
  const costsRepo = createCostsRepository(db);
  const broadcast = vi.fn<CostsBroadcast>();
  const recorder = createCostRecorder({ costsRepo, broadcast, now: () => 1_700_000_000_000 });
  return { db, companyId: company.id, costsRepo, broadcast, recorder };
};

describe("createCostRecorder.recordTurn", () => {
  it("inserts a row with computed cost cents", () => {
    const { recorder, companyId, db } = setup();
    const out = recorder.recordTurn({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: "sess_1",
      usage: { input: 1_000_000, output: 0, cache_creation: 0, cache_read: 0 },
    });
    expect(out.eventId.startsWith("cost_")).toBe(true);
    expect(out.costCents).toBe(300);
    const count = db.prepare("SELECT COUNT(*) AS n FROM cost_events").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("returns 0 cost when model is unknown but still persists tokens", () => {
    const { recorder, companyId, db } = setup();
    const out = recorder.recordTurn({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "future-model-not-mapped",
      sessionId: null,
      usage: { input: 1000, output: 500, cache_creation: 0, cache_read: 0 },
    });
    expect(out.costCents).toBe(0);
    const row = db
      .prepare("SELECT input_tokens, output_tokens FROM cost_events")
      .get() as { input_tokens: number; output_tokens: number };
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(500);
  });

  it("broadcasts a delta payload on insert", () => {
    const { recorder, broadcast, companyId } = setup();
    recorder.recordTurn({
      companyId,
      agentId: "agent_x",
      projectId: "proj_1",
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      usage: { input: 1000, output: 500, cache_creation: 0, cache_read: 0 },
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    const arg = broadcast.mock.calls[0]?.[0];
    expect(arg?.agentId).toBe("agent_x");
    expect(arg?.deltaTokens).toBe(1500);
    expect(typeof arg?.deltaCents).toBe("number");
  });

  it("skips persistence when usage is zero (defensive)", () => {
    const { recorder, broadcast, db, companyId } = setup();
    const out = recorder.recordTurn({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      usage: { input: 0, output: 0, cache_creation: 0, cache_read: 0 },
    });
    expect(out.eventId).toBe("");
    expect(out.costCents).toBe(0);
    const count = db.prepare("SELECT COUNT(*) AS n FROM cost_events").get() as { n: number };
    expect(count.n).toBe(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test costs.recorder`
Expected: FAIL — recorder module missing.

- [ ] **Step 3: Implement the recorder**

```ts
// apps/main/src/costs/recorder.ts
// Glue between adapter usage events and persisted cost_events rows.
// recordTurn validates non-zero usage, computes cost cents via the pricing
// table, persists, and broadcasts a small delta for live UI updates.

import type { UsageEstimate } from "@prospero/shared";
import { estimateCostCents } from "./pricing.js";
import type { CostsRepository } from "./repository.js";

export type RecordTurnInput = {
  companyId: string;
  agentId: string;
  projectId: string | null;
  issueId: string | null;
  adapterName: string;
  model: string | null;
  sessionId: string | null;
  usage: UsageEstimate;
};

export type CostsBroadcastPayload = {
  agentId: string;
  deltaTokens: number;
  deltaCents: number;
};

export type CostsBroadcast = (payload: CostsBroadcastPayload) => void;

export type CostRecorderDeps = {
  costsRepo: CostsRepository;
  broadcast: CostsBroadcast;
  now?: () => number;
};

export type CostRecorder = {
  recordTurn(input: RecordTurnInput): { eventId: string; costCents: number };
};

const sumUsage = (u: UsageEstimate): number =>
  u.input + u.output + u.cache_creation + u.cache_read;

export const createCostRecorder = (deps: CostRecorderDeps): CostRecorder => {
  const now = deps.now ?? ((): number => Date.now());

  const recordTurn = (
    input: RecordTurnInput,
  ): { eventId: string; costCents: number } => {
    const totalTokens = sumUsage(input.usage);
    if (totalTokens === 0) return { eventId: "", costCents: 0 };

    const costCents = estimateCostCents(input.model ?? undefined, input.usage);
    const row = deps.costsRepo.insert({
      companyId: input.companyId,
      agentId: input.agentId,
      projectId: input.projectId,
      issueId: input.issueId,
      adapterName: input.adapterName,
      model: input.model,
      sessionId: input.sessionId,
      inputTokens: input.usage.input,
      outputTokens: input.usage.output,
      cacheCreationTokens: input.usage.cache_creation,
      cacheReadTokens: input.usage.cache_read,
      costCentsEstimate: costCents,
      occurredAt: now(),
    });

    try {
      deps.broadcast({
        agentId: input.agentId,
        deltaTokens: totalTokens,
        deltaCents: costCents,
      });
    } catch (err) {
      console.warn("[costs] broadcast failed", err);
    }
    return { eventId: row.id, costCents };
  };

  return { recordTurn };
};
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test costs.recorder`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/costs/recorder.ts apps/main/tests/costs.recorder.test.ts
git commit -m "feat(m8): cost recorder wires pricing + repo + broadcast"
```

---

## Task 8: Budgets repository — read/write flat `budget.*` settings keys

**Files:**
- Create: `apps/main/src/costs/budgets-repository.ts`
- Create: `apps/main/tests/costs.budgets-repository.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/main/tests/costs.budgets-repository.test.ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createBudgetsRepository } from "../src/costs/budgets-repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return { db, repo: createBudgetsRepository(db) };
};

describe("budgets repository", () => {
  it("reads the seeded defaults from migration 0011", () => {
    const { repo } = setup();
    const b = repo.read();
    expect(b.maxTokensPerDayPerAgent).toBe(2_000_000);
    expect(b.maxTokensPerIssue).toBe(200_000);
    expect(b.rateLimitWindowTokens).toBe(1_000_000);
    expect(b.rateLimitWindowHours).toBe(5);
  });

  it("write merges partial input over existing values", () => {
    const { repo } = setup();
    repo.write({ maxTokensPerDayPerAgent: 500_000 });
    const b = repo.read();
    expect(b.maxTokensPerDayPerAgent).toBe(500_000);
    expect(b.maxTokensPerIssue).toBe(200_000);
  });

  it("rejects negative or non-integer values", () => {
    const { repo } = setup();
    expect(() => repo.write({ maxTokensPerDayPerAgent: -1 })).toThrow(/positive integer/i);
    expect(() => repo.write({ rateLimitWindowHours: 0 })).toThrow(/positive integer/i);
    expect(() => repo.write({ maxTokensPerIssue: 1.5 })).toThrow(/positive integer/i);
  });

  it("falls back to defaults if a key is missing or corrupt", () => {
    const { db, repo } = setup();
    db.prepare("DELETE FROM settings WHERE key = 'budget.max_tokens_per_issue'").run();
    db.prepare("UPDATE settings SET value = 'not-a-number' WHERE key = 'budget.rate_limit_window_hours'").run();
    const b = repo.read();
    expect(b.maxTokensPerIssue).toBe(200_000);
    expect(b.rateLimitWindowHours).toBe(5);
  });

  it("resetDefaults overwrites every key to the canonical default", () => {
    const { repo } = setup();
    repo.write({ maxTokensPerDayPerAgent: 1, maxTokensPerIssue: 1 });
    repo.resetDefaults();
    expect(repo.read()).toEqual({
      maxTokensPerDayPerAgent: 2_000_000,
      maxTokensPerIssue: 200_000,
      rateLimitWindowTokens: 1_000_000,
      rateLimitWindowHours: 5,
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test costs.budgets-repository`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the repository**

```ts
// apps/main/src/costs/budgets-repository.ts
// Reads + writes the 4 budget.* keys seeded by migration 0011.
// Validation is strict: positive integers only. UI must show errors inline,
// not silently coerce — that's why we throw instead of clamping.

import type Database from "better-sqlite3";

export type CostBudgets = {
  maxTokensPerDayPerAgent: number;
  maxTokensPerIssue: number;
  rateLimitWindowTokens: number;
  rateLimitWindowHours: number;
};

export type BudgetsRepository = {
  read(): CostBudgets;
  write(patch: Partial<CostBudgets>): void;
  resetDefaults(): void;
};

const DEFAULTS: CostBudgets = {
  maxTokensPerDayPerAgent: 2_000_000,
  maxTokensPerIssue: 200_000,
  rateLimitWindowTokens: 1_000_000,
  rateLimitWindowHours: 5,
};

const KEY_MAP: Record<keyof CostBudgets, string> = {
  maxTokensPerDayPerAgent: "budget.max_tokens_per_day_per_agent",
  maxTokensPerIssue: "budget.max_tokens_per_issue",
  rateLimitWindowTokens: "budget.rate_limit_window_tokens",
  rateLimitWindowHours: "budget.rate_limit_window_hours",
};

const isPositiveInt = (v: number): boolean =>
  Number.isInteger(v) && v > 0;

export const createBudgetsRepository = (db: Database.Database): BudgetsRepository => {
  const selectStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertStmt = db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  const readOne = (key: keyof CostBudgets): number => {
    const row = selectStmt.get(KEY_MAP[key]) as { value: string } | undefined;
    if (row === undefined) return DEFAULTS[key];
    const n = Number(row.value);
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : DEFAULTS[key];
  };

  const read = (): CostBudgets => ({
    maxTokensPerDayPerAgent: readOne("maxTokensPerDayPerAgent"),
    maxTokensPerIssue: readOne("maxTokensPerIssue"),
    rateLimitWindowTokens: readOne("rateLimitWindowTokens"),
    rateLimitWindowHours: readOne("rateLimitWindowHours"),
  });

  const write = (patch: Partial<CostBudgets>): void => {
    for (const key of Object.keys(patch) as (keyof CostBudgets)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      if (!isPositiveInt(value)) {
        throw new Error(
          `[budgets] ${key} must be a positive integer (got ${String(value)})`,
        );
      }
      upsertStmt.run(KEY_MAP[key], String(value));
    }
  };

  const resetDefaults = (): void => {
    for (const key of Object.keys(DEFAULTS) as (keyof CostBudgets)[]) {
      upsertStmt.run(KEY_MAP[key], String(DEFAULTS[key]));
    }
  };

  return { read, write, resetDefaults };
};
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test costs.budgets-repository`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/costs/budgets-repository.ts apps/main/tests/costs.budgets-repository.test.ts
git commit -m "feat(m8): budgets repository (4 flat KV settings + reset)"
```

---

## Task 9: Enforce-budget helper — soft-stop on cap overrun

**Files:**
- Create: `apps/main/src/costs/enforce-budget.ts`
- Create: `apps/main/tests/costs.enforce-budget.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/main/tests/costs.enforce-budget.test.ts
import { describe, expect, it, vi } from "vitest";
import { checkAndPause } from "../src/costs/enforce-budget.js";
import type { EnforceBudgetDeps } from "../src/costs/enforce-budget.js";

const makeDeps = (overrides: Partial<EnforceBudgetDeps> = {}): EnforceBudgetDeps => ({
  costsRepo: {
    insert: vi.fn(),
    getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
    getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
    hasAgentRowsForDay: vi.fn().mockReturnValue(false),
  } as unknown as EnforceBudgetDeps["costsRepo"],
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
  ...overrides,
});

describe("checkAndPause", () => {
  it("no-ops when daily and per-issue are under limits", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 500, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: "iss_1",
    });
    expect(r.paused).toBe(false);
    expect(deps.pauseAgent).not.toHaveBeenCalled();
    expect(deps.notifySecurityAlert).not.toHaveBeenCalled();
  });

  it("pauses + alerts when daily exceeds cap", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 1500, cents: 5 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: null,
    });
    expect(r.paused).toBe(true);
    expect(r.reason).toBe("budget_exceeded_daily");
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_daily");
    expect(deps.notifySecurityAlert).toHaveBeenCalledTimes(1);
    expect(deps.recordPauseActivity).toHaveBeenCalledTimes(1);
  });

  it("pauses + alerts when per-issue exceeds cap (even if daily is fine)", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 600, cents: 1 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: "iss_1",
    });
    expect(r.paused).toBe(true);
    expect(r.reason).toBe("budget_exceeded_issue");
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_issue");
  });

  it("skips per-issue check when issueId is null", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 9999, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: null,
    });
    expect(r.paused).toBe(false);
    expect(deps.costsRepo.getIssueTotal).not.toHaveBeenCalled();
  });

  it("daily check takes precedence when both are over", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 9999, cents: 99 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 9999, cents: 99 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: "iss_1",
    });
    expect(r.paused).toBe(true);
    expect(r.reason).toBe("budget_exceeded_daily");
    expect(deps.pauseAgent).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test costs.enforce-budget`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

```ts
// apps/main/src/costs/enforce-budget.ts
// Called after each cost recorder.recordTurn to enforce soft-stop budgets.
// Daily-per-agent and per-issue caps each trigger pause + Inbox alert +
// activity log. Daily wins precedence so the user sees the more global
// signal first. Pause is "soft" — the current turn already happened; the
// next enqueue is what gets parked by router (M7.6 enqueueOrPark).

import type { CostsRepository } from "./repository.js";
import type { BudgetsRepository } from "./budgets-repository.js";

export type PauseReason = "budget_exceeded_daily" | "budget_exceeded_issue";

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
  recordPauseActivity: (input: {
    companyId: string;
    agentId: string;
    reason: PauseReason;
  }) => void;
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
    return {
      paused: true,
      reason,
      tokens: daily.tokens,
      limit: budgets.maxTokensPerDayPerAgent,
    };
  }

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
      return {
        paused: true,
        reason,
        tokens: issueTotal.tokens,
        limit: budgets.maxTokensPerIssue,
      };
    }
  }

  return { paused: false };
};
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test costs.enforce-budget`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/costs/enforce-budget.ts apps/main/tests/costs.enforce-budget.test.ts
git commit -m "feat(m8): enforce-budget soft-stop helper (daily + per-issue)"
```

---

## Task 10: Day-summary lazy roll-up

**Files:**
- Create: `apps/main/src/costs/day-summary.ts`
- Create: `apps/main/tests/costs.day-summary.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/main/tests/costs.day-summary.test.ts
import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { ActivityEventRow } from "@prospero/shared";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createCostsRepository } from "../src/costs/repository.js";
import { createRecorder as createActivityRecorder } from "../src/activity/recorder.js";
import { rollUpYesterdayIfNeeded } from "../src/costs/day-summary.js";

const YESTERDAY = new Date("2026-05-11T12:00:00Z").getTime();
const TODAY = new Date("2026-05-12T12:00:00Z").getTime();

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const company = companies.create({ name: "Acme" });
  const costsRepo = createCostsRepository(db);
  const activityRecorder = createActivityRecorder(db, vi.fn<(r: ActivityEventRow) => void>(), {
    devMode: false,
  });
  return { db, companyId: company.id, costsRepo, activityRecorder };
};

describe("rollUpYesterdayIfNeeded", () => {
  it("emits cost.day_summary when agent has yesterday rows + no summary yet today", () => {
    const { db, companyId, costsRepo, activityRecorder } = setup();
    costsRepo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 2,
      occurredAt: YESTERDAY,
    });
    rollUpYesterdayIfNeeded({
      now: () => TODAY,
      companyId,
      agentId: "agent_x",
      costsRepo,
      activityRecorder,
    });
    const rows = db
      .prepare("SELECT payload_json FROM activity_events WHERE action = 'cost.day_summary'")
      .all() as Array<{ payload_json: string }>;
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]!.payload_json) as {
      inputTokens: number;
      outputTokens: number;
      totalUsd: number;
    };
    expect(payload.inputTokens).toBe(1000);
    expect(payload.outputTokens).toBe(500);
    expect(payload.totalUsd).toBeCloseTo(0.02, 2);
  });

  it("does NOT emit if agent has no rows yesterday", () => {
    const { db, companyId, costsRepo, activityRecorder } = setup();
    rollUpYesterdayIfNeeded({
      now: () => TODAY,
      companyId,
      agentId: "agent_x",
      costsRepo,
      activityRecorder,
    });
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM activity_events WHERE action = 'cost.day_summary'")
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("does NOT emit twice for the same day (idempotent within a day)", () => {
    const { db, companyId, costsRepo, activityRecorder } = setup();
    costsRepo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: null,
      sessionId: null,
      inputTokens: 1,
      outputTokens: 1,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 1,
      occurredAt: YESTERDAY,
    });
    rollUpYesterdayIfNeeded({
      now: () => TODAY,
      companyId,
      agentId: "agent_x",
      costsRepo,
      activityRecorder,
    });
    rollUpYesterdayIfNeeded({
      now: () => TODAY,
      companyId,
      agentId: "agent_x",
      costsRepo,
      activityRecorder,
    });
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM activity_events WHERE action = 'cost.day_summary'")
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test costs.day-summary`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the roll-up**

```ts
// apps/main/src/costs/day-summary.ts
// Lazy roll-up: called on every turn-complete, but only emits a
// cost.day_summary activity row once per agent per UTC day, when the agent
// has at least one cost_event from "yesterday" (relative to `now`).
//
// Idempotency relies on a SELECT against activity_events checking whether the
// agent already has a cost.day_summary row whose payload covers yesterday's
// UTC day boundary. We embed the UTC day timestamp in the payload as
// `daySummaryFor` to make this check straightforward.

import type Database from "better-sqlite3";
import type { Recorder as ActivityRecorder } from "../activity/recorder.js";
import type { CostsRepository } from "./repository.js";

type Deps = {
  now: () => number;
  companyId: string;
  agentId: string;
  costsRepo: CostsRepository;
  activityRecorder: ActivityRecorder;
};

const utcDayStart = (ts: number): number => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const rollUpYesterdayIfNeeded = (deps: Deps): void => {
  const todayStart = utcDayStart(deps.now());
  const yesterdayStart = todayStart - 86_400_000;
  const yesterdayDate = new Date(yesterdayStart);

  if (!deps.costsRepo.hasAgentRowsForDay(deps.agentId, yesterdayDate)) return;

  // Re-export the day-summary check below. We can't introspect the activity
  // repository directly, so we issue a small SELECT through the recorder's
  // db handle. The cleanest path is a callback into the activity repo, but
  // for simplicity we duck-type via the activityRecorder's private `db` —
  // not available. Use a separate prepared statement.
  // To keep this module self-contained, accept an extra `db` dep.
  throw new Error("internal: rollUpYesterdayIfNeeded needs db handle — patched below");
};
```

The above sketch is intentionally broken to make the next step visible: the function needs a `db` handle to query existing summaries. Patch the test to supply `db` and update the implementation:

Replace the implementation in `apps/main/src/costs/day-summary.ts` with the working version:

```ts
// apps/main/src/costs/day-summary.ts
// Lazy roll-up: emits a cost.day_summary activity row once per agent per UTC
// day, when the agent has at least one cost_event from "yesterday".
// Idempotency via a SELECT against activity_events filtered by action +
// agent_id + created_at window of today.

import type Database from "better-sqlite3";
import type { Recorder as ActivityRecorder } from "../activity/recorder.js";
import type { CostsRepository } from "./repository.js";

export type RollUpDeps = {
  db: Database.Database;
  now: () => number;
  companyId: string;
  agentId: string;
  costsRepo: CostsRepository;
  activityRecorder: ActivityRecorder;
};

const utcDayStart = (ts: number): number => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const rollUpYesterdayIfNeeded = (deps: RollUpDeps): void => {
  const todayStart = utcDayStart(deps.now());
  const yesterdayStart = todayStart - 86_400_000;
  const yesterdayDate = new Date(yesterdayStart);

  if (!deps.costsRepo.hasAgentRowsForDay(deps.agentId, yesterdayDate)) return;

  const alreadyDone = deps.db
    .prepare(
      `SELECT 1 AS hit FROM activity_events
       WHERE action = 'cost.day_summary'
         AND agent_id = ?
         AND created_at >= ?
       LIMIT 1`,
    )
    .get(deps.agentId, todayStart) as { hit: number } | undefined;
  if (alreadyDone !== undefined) return;

  const totals = (deps.db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input,
         COALESCE(SUM(output_tokens), 0) AS output,
         COALESCE(SUM(cost_cents_estimate), 0) AS cents
       FROM cost_events
       WHERE agent_id = ?
         AND occurred_at >= ?
         AND occurred_at < ?`,
    )
    .get(deps.agentId, yesterdayStart, todayStart)) as {
    input: number;
    output: number;
    cents: number;
  };

  deps.activityRecorder.recordActivity({
    companyId: deps.companyId,
    actor: { kind: "system" },
    action: "cost.day_summary",
    entityKind: "agent",
    entityId: deps.agentId,
    agentId: deps.agentId,
    payload: {
      inputTokens: totals.input,
      outputTokens: totals.output,
      totalUsd: totals.cents / 100,
    },
  });
};
```

Update the test setup to pass `db` into the call sites (3 places):

```ts
rollUpYesterdayIfNeeded({
  db,
  now: () => TODAY,
  companyId,
  agentId: "agent_x",
  costsRepo,
  activityRecorder,
});
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test costs.day-summary`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/costs/day-summary.ts apps/main/tests/costs.day-summary.test.ts
git commit -m "feat(m8): cost.day_summary lazy roll-up activity event"
```

---

## Task 11: Wire orchestrator-handlers — record + enforce + roll-up on turn-complete

**Files:**
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

- [ ] **Step 1: Locate the existing `turn-complete` branch**

In `apps/main/src/ipc/orchestrator-handlers.ts`, find the existing turn-complete handler block (around line 261):

```ts
} else if (ev.kind === "turn-complete") {
  collectedToolCalls.clear();
  router.onTurnComplete(agent.id);
  const stillBusy = router.getCurrentThread(agent.id) !== null;
  const status = stillBusy ? "thinking" : "idle";
  agents.updateStatus(agent.id, { status, currentAction: null });
  broadcast({
    kind: "status-changed",
    agentId: agent.id,
    status,
    updatedAt: Date.now(),
  });
  currentActionDebouncer.flush(agent.id);
  currentActionDebouncer.schedule(agent.id, null);
  broadcast({ kind: "roster-changed", companyId: agent.companyId });
} else if (ev.kind === "api-retry") {
```

- [ ] **Step 2: Add cost recording + enforcement + roll-up inside the turn-complete branch**

Insert this block at the START of the `turn-complete` branch (before `collectedToolCalls.clear()`):

```ts
} else if (ev.kind === "turn-complete") {
  // M8: persist usage + enforce budget + lazy day-summary roll-up.
  if (ev.usage !== undefined) {
    const currentIssueId = router.getCurrentIssue(agent.id);
    const projectIds = JSON.parse(agent.allowedProjects) as string[];
    const projectId = projectIds.length === 1 ? projectIds[0]! : null;
    costRecorder.recordTurn({
      companyId: agent.companyId,
      agentId: agent.id,
      projectId: projectId ?? null,
      issueId: currentIssueId,
      adapterName: agent.adapterName,
      model: ev.model ?? agent.model,
      sessionId: agent.claudeSessionId,
      usage: ev.usage,
    });
    const enforcement = checkAndPause(enforceDeps, {
      companyId: agent.companyId,
      agentId: agent.id,
      issueId: currentIssueId,
    });
    if (enforcement.paused) {
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
    }
    rollUpYesterdayIfNeeded({
      db,
      now: () => Date.now(),
      companyId: agent.companyId,
      agentId: agent.id,
      costsRepo,
      activityRecorder,
    });
  }
  collectedToolCalls.clear();
  router.onTurnComplete(agent.id);
  // ... rest unchanged
```

If `router.getCurrentIssue(agentId)` does not exist yet, add a one-liner getter in `apps/main/src/orchestrator/router.ts` next to `getCurrentThread`:

```ts
export const getCurrentIssue = (agentId: string): string | null => {
  const slot = slots.get(agentId);
  return slot?.issueId ?? null;
};
```

(If `slot.issueId` isn't already tracked in the router slot, fall back to `null` for v1 — per-issue enforcement degrades gracefully to "issue check skipped". Document this in the spec risk list as known limitation; per-agent daily cap still works.)

- [ ] **Step 3: Wire deps at the top of `registerOrchestratorHandlers`**

In the function body, near the existing repository instantiations, add:

```ts
const costsRepo = createCostsRepository(db);
const budgetsRepo = createBudgetsRepository(db);
const broadcastCostsDelta = createDebouncedBroadcast(broadcast, 1000);
const costRecorder = createCostRecorder({
  costsRepo,
  broadcast: broadcastCostsDelta,
});
const enforceDeps: EnforceBudgetDeps = {
  costsRepo,
  budgetsRepo,
  pauseAgent: (agentId, reason) => {
    agents.pause(agentId, reason);
    broadcast({ kind: "status-changed", agentId, status: "paused", updatedAt: Date.now() });
  },
  notifySecurityAlert: (input) => {
    inbox.create({
      companyId: input.companyId,
      kind: "security_alert",
      actorId: input.agentId,
      title: input.reason === "budget_exceeded_daily"
        ? "Budget diário excedido"
        : "Budget por issue excedido",
      preview: `Agent gastou ${String(input.tokens)} tokens (limite ${String(input.limit)})`,
      payloadJson: JSON.stringify(input),
      requiresAction: 1,
    });
  },
  recordPauseActivity: (input) => {
    activityRecorder.recordActivity({
      companyId: input.companyId,
      actor: { kind: "system" },
      action: "agent.paused",
      entityKind: "agent",
      entityId: input.agentId,
      agentId: input.agentId,
      payload: { reason: input.reason },
    });
  },
};
```

`createDebouncedBroadcast` is a small helper — define it inline if no existing utility exists:

```ts
const createDebouncedBroadcast = (
  broadcast: (msg: { kind: "costs:new"; agentId: string; deltaTokens: number; deltaCents: number }) => void,
  delayMs: number,
): CostsBroadcast => {
  let pending: Map<string, { tokens: number; cents: number }> = new Map();
  let timer: NodeJS.Timeout | null = null;
  return (payload) => {
    const existing = pending.get(payload.agentId) ?? { tokens: 0, cents: 0 };
    existing.tokens += payload.deltaTokens;
    existing.cents += payload.deltaCents;
    pending.set(payload.agentId, existing);
    if (timer === null) {
      timer = setTimeout(() => {
        for (const [agentId, agg] of pending.entries()) {
          broadcast({
            kind: "costs:new",
            agentId,
            deltaTokens: agg.tokens,
            deltaCents: agg.cents,
          });
        }
        pending = new Map();
        timer = null;
      }, delayMs);
    }
  };
};
```

Update the existing renderer broadcast `payload` union type to include the new `costs:new` kind (look for `type BroadcastPayload` or similar — extend it). If the renderer broadcast is loosely typed (`unknown`), no change needed.

Imports to add at the top of `orchestrator-handlers.ts`:

```ts
import { createCostsRepository } from "../costs/repository.js";
import { createBudgetsRepository } from "../costs/budgets-repository.js";
import { createCostRecorder, type CostsBroadcast } from "../costs/recorder.js";
import { checkAndPause, type EnforceBudgetDeps } from "../costs/enforce-budget.js";
import { rollUpYesterdayIfNeeded } from "../costs/day-summary.js";
```

- [ ] **Step 4: Run typecheck + main suite**

Run: `pnpm typecheck && pnpm --filter @prospero/main test`
Expected: PASS. If `agents.pause` does not exist as a single-arg API, look up the existing M7.6 pause method — likely `agents.pause(agentId)` with reason set separately, or `agents.setStatus(agentId, 'paused', { reason })`. Match what M7.6 actually exposes.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/ipc/orchestrator-handlers.ts apps/main/src/orchestrator/router.ts
git commit -m "feat(m8): wire cost recorder + budget enforcement into turn-complete"
```

---

## Task 12: Costs IPC handlers — `query`, `aggregate-today`, `get-budgets`, `set-budgets`

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `packages/shared/src/types/costs.ts`
- Modify: `packages/shared/src/index.ts` (re-export costs types)
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`
- Create: `apps/main/tests/ipc.costs-handlers.test.ts`

- [ ] **Step 1: Add IPC channel constants**

In `packages/shared/src/ipc-channels.ts`, append before `} as const;`:

```ts
  COSTS_QUERY: "costs:query",
  COSTS_AGGREGATE_TODAY: "costs:aggregate-today",
  COSTS_GET_BUDGETS: "costs:get-budgets",
  COSTS_SET_BUDGETS: "costs:set-budgets",
  COSTS_NEW: "costs:new",
```

- [ ] **Step 2: Add shared types for costs**

```ts
// packages/shared/src/types/costs.ts
export type CostBucket = {
  bucketStart: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costCents: number;
};

export type CostAgentTotal = {
  agentId: string;
  agentName: string;
  tokens: number;
  cents: number;
};

export type CostProjectTotal = {
  projectId: string | null;
  projectName: string | null;
  tokens: number;
  cents: number;
};

export type CostsQueryInput = {
  companyId: string;
  scope: "company" | "agent" | "project" | "issue";
  refId?: string;
  adapterName?: string;
  from: number;
  to: number;
  bucket: "day" | "hour";
};

export type CostsQueryResult = {
  buckets: CostBucket[];
  byAgent: CostAgentTotal[];
  byProject: CostProjectTotal[];
  total: { tokens: number; cents: number };
};

export type CostsAggregateTodayResult = {
  totalCents: number;
  totalTokens: number;
  percentMax: number;
  byAgent: CostAgentTotal[];
};

export type CostBudgets = {
  maxTokensPerDayPerAgent: number;
  maxTokensPerIssue: number;
  rateLimitWindowTokens: number;
  rateLimitWindowHours: number;
};
```

Re-export from `packages/shared/src/index.ts`:

```ts
export * from "./types/costs.js";
```

- [ ] **Step 3: Write failing IPC handler tests**

```ts
// apps/main/tests/ipc.costs-handlers.test.ts
import { describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createCostsRepository } from "../src/costs/repository.js";
import {
  registerCostsHandlers,
} from "../src/ipc/costs-handlers.js";

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

const setup = () => {
  vi.clearAllMocks();
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const company = companies.create({ name: "Acme" });
  const costsRepo = createCostsRepository(db);
  registerCostsHandlers(db);
  // Capture registered handlers by name.
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  for (const call of (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls) {
    handlers.set(call[0] as string, call[1] as (...args: unknown[]) => unknown);
  }
  return { db, companyId: company.id, costsRepo, handlers };
};

describe("costs IPC handlers", () => {
  it("costs:query returns total over the requested range", () => {
    const { companyId, costsRepo, handlers } = setup();
    costsRepo.insert({
      companyId,
      agentId: "agent_x",
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-local",
      model: "claude-sonnet-4-6",
      sessionId: null,
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costCentsEstimate: 3,
      occurredAt: Date.UTC(2026, 4, 12, 10),
    });
    const handler = handlers.get("costs:query")!;
    const result = handler(null, {
      companyId,
      scope: "company",
      from: Date.UTC(2026, 4, 12),
      to: Date.UTC(2026, 4, 13),
      bucket: "day",
    }) as { total: { tokens: number; cents: number }; buckets: unknown[] };
    expect(result.total.tokens).toBe(150);
    expect(result.total.cents).toBe(3);
    expect(result.buckets).toHaveLength(1);
  });

  it("costs:aggregate-today returns 0 when no rows exist for today", () => {
    const { companyId, handlers } = setup();
    const handler = handlers.get("costs:aggregate-today")!;
    const result = handler(null, { companyId }) as {
      totalCents: number;
      totalTokens: number;
    };
    expect(result.totalCents).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it("costs:get-budgets returns the seeded defaults", () => {
    const { handlers } = setup();
    const handler = handlers.get("costs:get-budgets")!;
    const result = handler(null, {}) as { maxTokensPerDayPerAgent: number };
    expect(result.maxTokensPerDayPerAgent).toBe(2_000_000);
  });

  it("costs:set-budgets updates a subset and returns the merged set", () => {
    const { handlers } = setup();
    const setHandler = handlers.get("costs:set-budgets")!;
    const updated = setHandler(null, { maxTokensPerIssue: 100_000 }) as {
      maxTokensPerIssue: number;
      maxTokensPerDayPerAgent: number;
    };
    expect(updated.maxTokensPerIssue).toBe(100_000);
    expect(updated.maxTokensPerDayPerAgent).toBe(2_000_000);
  });

  it("costs:set-budgets rejects invalid input", () => {
    const { handlers } = setup();
    const setHandler = handlers.get("costs:set-budgets")!;
    expect(() => setHandler(null, { maxTokensPerIssue: -1 })).toThrow(/positive integer/i);
  });
});
```

- [ ] **Step 4: Run tests — expect failures**

Run: `pnpm --filter @prospero/main test ipc.costs-handlers`
Expected: FAIL — `registerCostsHandlers` and `costs-handlers.ts` do not exist.

- [ ] **Step 5: Implement the handlers module**

```ts
// apps/main/src/ipc/costs-handlers.ts
// 4 IPC handlers for the /costs route + Dashboard widget + Settings Budgets.
// Aggregation queries run directly against cost_events; budgets via the
// dedicated repository.

import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import type {
  CostsQueryInput,
  CostsQueryResult,
  CostsAggregateTodayResult,
  CostBudgets,
  CostBucket,
  CostAgentTotal,
  CostProjectTotal,
} from "@prospero/shared";
import { createCostsRepository } from "../costs/repository.js";
import { createBudgetsRepository } from "../costs/budgets-repository.js";

const bucketMs = (b: "day" | "hour"): number =>
  b === "day" ? 86_400_000 : 3_600_000;

const queryCompany = (
  db: Database.Database,
  input: CostsQueryInput,
): CostsQueryResult => {
  const step = bucketMs(input.bucket);
  const conditions: string[] = ["company_id = ?", "occurred_at >= ?", "occurred_at < ?"];
  const params: unknown[] = [input.companyId, input.from, input.to];
  if (input.scope === "agent" && input.refId !== undefined) {
    conditions.push("agent_id = ?");
    params.push(input.refId);
  } else if (input.scope === "project" && input.refId !== undefined) {
    conditions.push("project_id = ?");
    params.push(input.refId);
  } else if (input.scope === "issue" && input.refId !== undefined) {
    conditions.push("issue_id = ?");
    params.push(input.refId);
  }
  if (input.adapterName !== undefined) {
    conditions.push("adapter_name = ?");
    params.push(input.adapterName);
  }
  const where = conditions.join(" AND ");

  const bucketRows = db
    .prepare(
      `SELECT
         (occurred_at - (occurred_at % ${String(step)})) AS bucket_start,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cost_cents_estimate), 0) AS cost_cents
       FROM cost_events WHERE ${where}
       GROUP BY bucket_start
       ORDER BY bucket_start ASC`,
    )
    .all(...params) as Array<{
    bucket_start: number;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    cost_cents: number;
  }>;
  const buckets: CostBucket[] = bucketRows.map((r) => ({
    bucketStart: r.bucket_start,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    cacheReadTokens: r.cache_read_tokens,
    costCents: r.cost_cents,
  }));

  const agentRows = db
    .prepare(
      `SELECT cost_events.agent_id AS agent_id,
              COALESCE(agents.name, '(deleted)') AS agent_name,
              COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) AS tokens,
              COALESCE(SUM(cost_cents_estimate), 0) AS cents
       FROM cost_events
       LEFT JOIN agents ON agents.id = cost_events.agent_id
       WHERE ${where} AND cost_events.agent_id IS NOT NULL
       GROUP BY cost_events.agent_id, agents.name
       ORDER BY tokens DESC
       LIMIT 10`,
    )
    .all(...params) as Array<{ agent_id: string; agent_name: string; tokens: number; cents: number }>;
  const byAgent: CostAgentTotal[] = agentRows.map((r) => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    tokens: r.tokens,
    cents: r.cents,
  }));

  const projectRows = db
    .prepare(
      `SELECT cost_events.project_id AS project_id,
              projects.name AS project_name,
              COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) AS tokens,
              COALESCE(SUM(cost_cents_estimate), 0) AS cents
       FROM cost_events
       LEFT JOIN projects ON projects.id = cost_events.project_id
       WHERE ${where}
       GROUP BY cost_events.project_id, projects.name
       ORDER BY tokens DESC`,
    )
    .all(...params) as Array<{
    project_id: string | null;
    project_name: string | null;
    tokens: number;
    cents: number;
  }>;
  const byProject: CostProjectTotal[] = projectRows.map((r) => ({
    projectId: r.project_id,
    projectName: r.project_name,
    tokens: r.tokens,
    cents: r.cents,
  }));

  const total = buckets.reduce(
    (acc, b) => ({
      tokens:
        acc.tokens +
        b.inputTokens +
        b.outputTokens +
        b.cacheCreationTokens +
        b.cacheReadTokens,
      cents: acc.cents + b.costCents,
    }),
    { tokens: 0, cents: 0 },
  );

  return { buckets, byAgent, byProject, total };
};

const aggregateToday = (
  db: Database.Database,
  companyId: string,
): CostsAggregateTodayResult => {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = start + 86_400_000;
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) AS tokens,
         COALESCE(SUM(cost_cents_estimate), 0) AS cents
       FROM cost_events
       WHERE company_id = ? AND occurred_at >= ? AND occurred_at < ?`,
    )
    .get(companyId, start, end) as { tokens: number; cents: number };

  const byAgentRows = db
    .prepare(
      `SELECT cost_events.agent_id AS agent_id,
              COALESCE(agents.name, '(deleted)') AS agent_name,
              COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) AS tokens,
              COALESCE(SUM(cost_cents_estimate), 0) AS cents
       FROM cost_events
       LEFT JOIN agents ON agents.id = cost_events.agent_id
       WHERE cost_events.company_id = ? AND occurred_at >= ? AND occurred_at < ?
         AND cost_events.agent_id IS NOT NULL
       GROUP BY cost_events.agent_id, agents.name
       ORDER BY tokens DESC
       LIMIT 5`,
    )
    .all(companyId, start, end) as Array<{
    agent_id: string;
    agent_name: string;
    tokens: number;
    cents: number;
  }>;

  const budgets = createBudgetsRepository(db).read();
  const windowMs = budgets.rateLimitWindowHours * 3_600_000;
  const windowStart = Date.now() - windowMs;
  const windowRow = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
       FROM cost_events
       WHERE company_id = ? AND occurred_at >= ?`,
    )
    .get(companyId, windowStart) as { tokens: number };
  const percentMax =
    budgets.rateLimitWindowTokens > 0
      ? Math.min(
          100,
          Math.round((windowRow.tokens / budgets.rateLimitWindowTokens) * 100),
        )
      : 0;

  return {
    totalCents: row.cents,
    totalTokens: row.tokens,
    percentMax,
    byAgent: byAgentRows.map((r) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      tokens: r.tokens,
      cents: r.cents,
    })),
  };
};

export const registerCostsHandlers = (db: Database.Database): void => {
  const budgetsRepo = createBudgetsRepository(db);
  // Reference createCostsRepository to satisfy unused-import lint; the repo
  // is used inside queryCompany via direct SQL but we keep this import for
  // any future migration to the repository abstraction.
  void createCostsRepository;

  ipcMain.handle(IPC.COSTS_QUERY, (_e, payload: CostsQueryInput): CostsQueryResult => {
    return queryCompany(db, payload);
  });

  ipcMain.handle(
    IPC.COSTS_AGGREGATE_TODAY,
    (_e, payload: { companyId: string }): CostsAggregateTodayResult => {
      return aggregateToday(db, payload.companyId);
    },
  );

  ipcMain.handle(IPC.COSTS_GET_BUDGETS, (): CostBudgets => budgetsRepo.read());

  ipcMain.handle(
    IPC.COSTS_SET_BUDGETS,
    (_e, payload: Partial<CostBudgets>): CostBudgets => {
      budgetsRepo.write(payload);
      return budgetsRepo.read();
    },
  );
};
```

- [ ] **Step 6: Call `registerCostsHandlers` from the main entrypoint**

Locate where other handlers are registered (e.g. `apps/main/src/index.ts` or similar). Add:

```ts
import { registerCostsHandlers } from "./ipc/costs-handlers.js";
// ...
registerCostsHandlers(db);
```

- [ ] **Step 7: Run tests — expect pass**

Run: `pnpm --filter @prospero/main test ipc.costs-handlers`
Expected: 5 PASS.

- [ ] **Step 8: Run full main test suite to confirm no regressions**

Run: `pnpm --filter @prospero/main test`
Expected: PASS — pre-M8 baseline 472 plus ~30-35 new from tasks 1–12 ≈ 505-510 tests green.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/ipc-channels.ts packages/shared/src/types/costs.ts packages/shared/src/index.ts apps/main/src/ipc/costs-handlers.ts apps/main/tests/ipc.costs-handlers.test.ts apps/main/src/index.ts
git commit -m "feat(m8): costs IPC handlers (query, aggregate-today, get/set-budgets)"
```

---

## Task 13: Smoke test + final commit

**Files:** none (manual)

- [ ] **Step 1: Build and run the Electron app**

Run: `pnpm dev`
Expected: app boots, renderer loads.

- [ ] **Step 2: Manual smoke — record a few turns**

In the app:
1. Hire a Frontend Engineer agent (if not already present)
2. Open chat with CEO, send: "Hi"
3. Wait for response
4. Send: "What's 2+2?"
5. Wait for response
6. Verify in the dev console main-process log that `[costs]` broadcast events fire after each turn

- [ ] **Step 3: Verify DB rows**

In a separate terminal:

```powershell
$dbPath = "$env:APPDATA\Electron\prospero.db"
sqlite3 $dbPath "SELECT COUNT(*) FROM cost_events"
sqlite3 $dbPath "SELECT agent_id, model, input_tokens, output_tokens, cost_cents_estimate FROM cost_events ORDER BY occurred_at DESC LIMIT 5"
```

Expected: ≥2 rows with `input_tokens > 0`, model populated, `cost_cents_estimate > 0`.

- [ ] **Step 4: Verify soft-stop fires**

Set a tiny budget via `costs:set-budgets`:

```powershell
sqlite3 $dbPath "UPDATE settings SET value='100' WHERE key='budget.max_tokens_per_day_per_agent'"
```

Restart the app, send one message to the CEO. Expected: after the response, the agent gets paused — sidebar shows status "paused", a new inbox item appears with kind=security_alert.

Restore the default:

```powershell
sqlite3 $dbPath "UPDATE settings SET value='2000000' WHERE key='budget.max_tokens_per_day_per_agent'"
```

- [ ] **Step 5: Final test pass + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: ALL PASS.

- [ ] **Step 6: Mark PR-A complete**

```bash
git log --oneline -15
```

Expected: ~12 commits on PR-A branch (one per task). Open PR with summary linking to spec.

---

## Spec coverage self-review

Cross-referencing each requirement in [2026-05-12-m8-costs-design.md](../specs/2026-05-12-m8-costs-design.md):

| Spec section | Covered by |
|---|---|
| §3.1 D1 schema new, drop costs_log | Task 1 |
| §3.2 D2 stream-parser usage on turn-complete | Tasks 2–3 |
| §3.3 D3 costRecorder mirrors activityRecorder | Task 7 |
| §3.4 D4 soft-stop hook at turn-complete | Tasks 9, 11 |
| §3.5 D5 pricing table + estimateCostCents | Task 5 |
| §3.6 D6 %Max via rolling window | Task 12 (aggregateToday) |
| §3.7 D7 recharts lazy-loaded | **PR-B** (out of scope here) |
| §3.8 D8 budget caps as flat KV | Tasks 1 (seed), 8 (repo), 12 (IPC) |
| §3.9 D9 cost.day_summary lazy roll-up | Task 10 |
| §5 schema | Task 1 |
| §6 ParsedEvent extension | Task 2 |
| §7 IPC handlers | Task 12 |
| §8 UI | **PR-B** |
| §9 error handling | Tasks 3 (safeReadUsage), 5 (unknown model), 8 (budget validation), 10 (idempotent rollup) |
| §10.1 unit tests | Every task |
| §10.2 integration tests | Tasks 11 (lifecycle wire), 13 (smoke) |
| §10.3 renderer tests | **PR-B** |
| §10.4 non-regression | Task 13 (smoke + full suite) |

PR-B-only items (UI route, Dashboard widget, StatsTab real, Settings UI, ModelDropdown hints, i18n keys, recharts dep) are explicitly out of scope — covered in the next plan after PR-A merges.

## Placeholder scan

Searched for: "TBD", "TODO", "implement later", "add appropriate error handling". None found in plan steps.

The Task 11 step 3 acknowledges that `agents.pause` API shape may need lookup at implementation time — this is documented as "match what M7.6 actually exposes" rather than left as TBD, because the M7.6 lessons memory confirms `pause(id, reason?)` exists; the plan defers the exact arg shape to the actual file read.

Similarly, Task 11 documents `router.getCurrentIssue` may not exist — falls back to `null` with documented degradation, not TBD.

## Type consistency

- `UsageEstimate` field names (`input`, `output`, `cache_creation`, `cache_read`) match across Tasks 2, 3, 4, 5, 7, 10.
- `CostBudgets` field names (`maxTokensPerDayPerAgent`, etc.) match across Tasks 8, 9, 12.
- `PauseReason` literal union (`"budget_exceeded_daily" | "budget_exceeded_issue"`) used consistently in Tasks 9 and 11.
- `CostEventInsert` shape (snake_case in SQL, camelCase in TS) is consistent across Tasks 6, 7.

---

**Plan complete.** Saved to `docs/superpowers/plans/2026-05-12-m8-pr-a-costs-backend.md`.

## Execution Handoff

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (code review + verification) between tasks
2. **Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints

The M7.6 lessons memory notes "inline execution > subagent-driven pra tasks mecânicas com plano detalhado". For this PR-A, inline is the better fit — the plan is highly mechanical (one new file per task, well-isolated TDD steps).
