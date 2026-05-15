# M8 PR-B — Costs UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visualize cost data captured by PR-A. Ship `/costs` route with charts + filters, Dashboard "Custos hoje" widget, real StatsTab tokens, Settings Budgets section, and ModelDropdown cost hints — all wired to the 4 IPCs PR-A registered.

**Architecture:** Renderer-only changes plus 2 lines in preload + env.d.ts (expose 4 IPCs + 1 broadcast on `window.prospero.costs`). New `/costs` route is `React.lazy` so recharts (~50 kB gzip) lives in a separate chunk and doesn't inflate the main bundle. Pure-fn helpers (`bucketByDay`, `formatCents`, `categorizeCostTier`) get vitest coverage; components are smoke-tested via existing M7.7 pure-fn pattern (no RTL/jsdom — that infrastructure was deferred in M7.7 lessons).

**Tech Stack:** React 18, react-router-dom 6, zustand, react-i18next, recharts (new dep), vitest. Spec: [docs/superpowers/specs/2026-05-12-m8-costs-design.md](../specs/2026-05-12-m8-costs-design.md) §8.

**Prereq:** M8 PR-A backend mergeado em master (`56da29c`). 4 IPCs disponíveis: `costs:query`, `costs:aggregate-today`, `costs:get-budgets`, `costs:set-budgets`. Broadcast `costs:new` debounced 1s.

---

## File map

**Create:**
- `apps/renderer/src/lib/costs/bucketByDay.ts` (pure fn)
- `apps/renderer/src/lib/costs/formatCents.ts` (pure fn)
- `apps/renderer/src/lib/costs/categorizeCostTier.ts` (pure fn)
- `apps/renderer/src/lib/costs/bucketByDay.test.ts`
- `apps/renderer/src/lib/costs/formatCents.test.ts`
- `apps/renderer/src/lib/costs/categorizeCostTier.test.ts`
- `apps/renderer/src/stores/budgets.ts`
- `apps/renderer/src/hooks/useCostsQuery.ts`
- `apps/renderer/src/hooks/useCostsQuery.test.ts`
- `apps/renderer/src/hooks/useCostsToday.ts`
- `apps/renderer/src/hooks/useCostsStream.ts`
- `apps/renderer/src/components/costs/CostsHeader.tsx`
- `apps/renderer/src/components/costs/CostsFilters.tsx`
- `apps/renderer/src/components/costs/CostsChartTimeSeries.tsx`
- `apps/renderer/src/components/costs/CostsChartByAgent.tsx`
- `apps/renderer/src/components/costs/CostsChartByProject.tsx`
- `apps/renderer/src/components/costs/CostsTableRecent.tsx`
- `apps/renderer/src/components/costs/CostsTodayWidget.tsx`
- `apps/renderer/src/components/costs/BudgetsForm.tsx`
- `apps/renderer/src/routes/Costs.tsx`

**Modify:**
- `apps/main/src/ipc/preload.ts` — expose `costs` namespace (4 invokes + 1 broadcast listener)
- `apps/renderer/src/env.d.ts` — add `costs` to `window.prospero` type + import new shared types
- `apps/renderer/package.json` — `pnpm add recharts`
- `apps/renderer/src/App.tsx` — add `/costs` lazy route + NavLink between Skills and Activity
- `apps/renderer/src/routes/Dashboard.tsx` — render `<CostsTodayWidget />`
- `apps/renderer/src/routes/Settings.tsx` — add `<BudgetsForm />` section
- `apps/renderer/src/components/agent-panel/StatsTab.tsx` — replace placeholder tokensIn/Out with real cost query
- `apps/renderer/src/components/ModelDropdown.tsx` — add cost tier hint chips
- `apps/renderer/src/i18n/pt-BR.json` + `en-US.json` — costs.* / dashboard.costsToday.* / settings.budgets.* / agent.stats.* / model.costHint.* / nav.costs

**Out of scope (deferred):**
- `rate_limit_event` real parsing — spec D6 says v1 uses rolling window (already done in PR-A `aggregateToday`)
- Activity action `cost.day_summary` UI rendering — payload schema exists (PR-A); rendering in `/activity` is M9 polish, not blocking
- Multi-currency / BRL conversion — spec §12 R7 says "v1 só USD"
- `cost-cents` cost field in /agent route — out of scope (StatsTab cobre)

---

## Task 1: Pure-fn `bucketByDay` + tests

**Files:**
- Create: `apps/renderer/src/lib/costs/bucketByDay.ts`
- Create: `apps/renderer/src/lib/costs/bucketByDay.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/renderer/src/lib/costs/bucketByDay.test.ts
import { describe, expect, it } from "vitest";
import type { CostBucket } from "@prospero/shared";
import { fillMissingDays } from "./bucketByDay.js";

const bucket = (start: number, tokens: number): CostBucket => ({
  bucketStart: start,
  inputTokens: tokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costCents: 0,
});

describe("fillMissingDays", () => {
  it("inserts zero buckets between existing days", () => {
    const day0 = Date.UTC(2026, 4, 10);
    const day2 = Date.UTC(2026, 4, 12);
    const input = [bucket(day0, 100), bucket(day2, 200)];
    const out = fillMissingDays(input, day0, day2 + 86_400_000);
    expect(out).toHaveLength(3);
    expect(out[0]?.bucketStart).toBe(day0);
    expect(out[0]?.inputTokens).toBe(100);
    expect(out[1]?.bucketStart).toBe(Date.UTC(2026, 4, 11));
    expect(out[1]?.inputTokens).toBe(0);
    expect(out[2]?.bucketStart).toBe(day2);
    expect(out[2]?.inputTokens).toBe(200);
  });

  it("returns empty when from === to", () => {
    const day = Date.UTC(2026, 4, 10);
    const out = fillMissingDays([], day, day);
    expect(out).toEqual([]);
  });

  it("pads zeros when input is empty but range is non-empty", () => {
    const from = Date.UTC(2026, 4, 10);
    const to = Date.UTC(2026, 4, 13);
    const out = fillMissingDays([], from, to);
    expect(out).toHaveLength(3);
    expect(out.every((b) => b.inputTokens === 0 && b.costCents === 0)).toBe(true);
  });

  it("preserves cache + cost fields from input buckets", () => {
    const day = Date.UTC(2026, 4, 10);
    const input = [
      {
        bucketStart: day,
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 1000,
        cacheReadTokens: 200,
        costCents: 5,
      },
    ];
    const out = fillMissingDays(input, day, day + 86_400_000);
    expect(out[0]?.cacheCreationTokens).toBe(1000);
    expect(out[0]?.cacheReadTokens).toBe(200);
    expect(out[0]?.costCents).toBe(5);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm --filter @prospero/renderer test bucketByDay`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// apps/renderer/src/lib/costs/bucketByDay.ts
// Pads zero buckets for missing days in a time range so charts draw a
// continuous line instead of skipping gaps. Input must already be daily-
// bucketed (bucketStart == UTC midnight). Range is [from, to) — half-open.

import type { CostBucket } from "@prospero/shared";

const DAY_MS = 86_400_000;

const emptyBucket = (bucketStart: number): CostBucket => ({
  bucketStart,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costCents: 0,
});

export const fillMissingDays = (
  buckets: CostBucket[],
  fromMs: number,
  toMs: number,
): CostBucket[] => {
  if (toMs <= fromMs) return [];
  const byStart = new Map<number, CostBucket>(buckets.map((b) => [b.bucketStart, b]));
  const out: CostBucket[] = [];
  for (let t = fromMs; t < toMs; t += DAY_MS) {
    out.push(byStart.get(t) ?? emptyBucket(t));
  }
  return out;
};
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter @prospero/renderer test bucketByDay`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/lib/costs/bucketByDay.ts apps/renderer/src/lib/costs/bucketByDay.test.ts
git commit -m "feat(m8-ui): bucketByDay pads zero days for continuous chart"
```

---

## Task 2: Pure-fn `formatCents` + tests

**Files:**
- Create: `apps/renderer/src/lib/costs/formatCents.ts`
- Create: `apps/renderer/src/lib/costs/formatCents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/renderer/src/lib/costs/formatCents.test.ts
import { describe, expect, it } from "vitest";
import { formatCents, formatTokens } from "./formatCents.js";

describe("formatCents", () => {
  it("formats whole dollars with $ prefix and 2 decimals", () => {
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(99)).toBe("$0.99");
  });

  it("formats zero as $0.00", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats large amounts with comma separators (en-US locale)", () => {
    expect(formatCents(1_234_567)).toBe("$12,345.67");
  });

  it("handles negative cents gracefully (clamps to 0)", () => {
    expect(formatCents(-50)).toBe("$0.00");
  });
});

describe("formatTokens", () => {
  it("formats < 1000 as raw number", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats >= 1000 with k suffix and 1 decimal", () => {
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(9_999)).toBe("10.0k");
  });

  it("formats >= 1M with M suffix", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(12_345_678)).toBe("12.3M");
  });

  it("handles negative as 0", () => {
    expect(formatTokens(-10)).toBe("0");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm --filter @prospero/renderer test formatCents`
Expected: FAIL.

- [ ] **Step 3: Implement the helpers**

```ts
// apps/renderer/src/lib/costs/formatCents.ts
// USD only in v1 (spec §12 R7 — câmbio dinâmico = v2).

export const formatCents = (cents: number): string => {
  const safe = Math.max(0, cents);
  const dollars = safe / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
};

export const formatTokens = (tokens: number): string => {
  const safe = Math.max(0, tokens);
  if (safe < 1000) return String(safe);
  if (safe < 1_000_000) return `${(safe / 1000).toFixed(1)}k`;
  return `${(safe / 1_000_000).toFixed(1)}M`;
};
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter @prospero/renderer test formatCents`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/lib/costs/formatCents.ts apps/renderer/src/lib/costs/formatCents.test.ts
git commit -m "feat(m8-ui): formatCents + formatTokens helpers"
```

---

## Task 3: Pure-fn `categorizeCostTier` + tests

**Files:**
- Create: `apps/renderer/src/lib/costs/categorizeCostTier.ts`
- Create: `apps/renderer/src/lib/costs/categorizeCostTier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/renderer/src/lib/costs/categorizeCostTier.test.ts
import { describe, expect, it } from "vitest";
import { categorizeCostTier } from "./categorizeCostTier.js";

describe("categorizeCostTier", () => {
  it("returns 'cheap' for haiku", () => {
    expect(categorizeCostTier("claude-haiku-4-5-20251001").tier).toBe("cheap");
  });

  it("returns 'medium' for sonnet", () => {
    expect(categorizeCostTier("claude-sonnet-4-6").tier).toBe("medium");
  });

  it("returns 'expensive' for opus", () => {
    expect(categorizeCostTier("claude-opus-4-7").tier).toBe("expensive");
  });

  it("returns 'unknown' for unmapped model id", () => {
    expect(categorizeCostTier("future-model-x").tier).toBe("unknown");
  });

  it("returns 'unknown' for empty string", () => {
    expect(categorizeCostTier("").tier).toBe("unknown");
  });

  it("includes the symbol for known tiers", () => {
    expect(categorizeCostTier("claude-haiku-4-5-20251001").symbol).toBe("$");
    expect(categorizeCostTier("claude-sonnet-4-6").symbol).toBe("$$");
    expect(categorizeCostTier("claude-opus-4-7").symbol).toBe("$$$");
  });

  it("returns no symbol for unknown tier", () => {
    expect(categorizeCostTier("foo").symbol).toBe("");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm --filter @prospero/renderer test categorizeCostTier`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/renderer/src/lib/costs/categorizeCostTier.ts
// Relative cost tier for the ModelDropdown hint chip. v1 is hard-coded
// against the 3 Claude 4.x presets the pricing table covers. Future models
// fall back to "unknown" (no chip shown).

export type CostTier = "cheap" | "medium" | "expensive" | "unknown";

export type CostTierInfo = {
  tier: CostTier;
  symbol: "" | "$" | "$$" | "$$$";
};

const TIER_BY_MODEL: Record<string, CostTier> = {
  "claude-haiku-4-5-20251001": "cheap",
  "claude-sonnet-4-6": "medium",
  "claude-opus-4-7": "expensive",
};

const SYMBOL_BY_TIER: Record<CostTier, CostTierInfo["symbol"]> = {
  cheap: "$",
  medium: "$$",
  expensive: "$$$",
  unknown: "",
};

export const categorizeCostTier = (model: string): CostTierInfo => {
  const tier = TIER_BY_MODEL[model] ?? "unknown";
  return { tier, symbol: SYMBOL_BY_TIER[tier] };
};
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter @prospero/renderer test categorizeCostTier`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/lib/costs/categorizeCostTier.ts apps/renderer/src/lib/costs/categorizeCostTier.test.ts
git commit -m "feat(m8-ui): categorizeCostTier for ModelDropdown hint"
```

---

## Task 4: preload.ts + env.d.ts — expose `costs` namespace

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Add costs IPC bindings in preload.ts**

In `apps/main/src/ipc/preload.ts`, first extend the type imports at the top (around line 26):

```ts
  type ActivityEventRow,
  type ActivityQueryParams,
  type CostsQueryInput,
  type CostsQueryResult,
  type CostsAggregateTodayResult,
  type CostBudgets,
} from "@prospero/shared";
```

Then, inside the `contextBridge.exposeInMainWorld("prospero", {...})` object, find the `activity:` namespace and add a sibling `costs:` namespace right after it:

```ts
  costs: {
    query: (input: CostsQueryInput) =>
      ipcRenderer.invoke(IPC.COSTS_QUERY, input) as Promise<CostsQueryResult>,
    aggregateToday: (payload: { companyId: string }) =>
      ipcRenderer.invoke(
        IPC.COSTS_AGGREGATE_TODAY,
        payload,
      ) as Promise<CostsAggregateTodayResult>,
    getBudgets: () => ipcRenderer.invoke(IPC.COSTS_GET_BUDGETS) as Promise<CostBudgets>,
    setBudgets: (patch: Partial<CostBudgets>) =>
      ipcRenderer.invoke(IPC.COSTS_SET_BUDGETS, patch) as Promise<CostBudgets>,
    onNew: (
      cb: (payload: { agentId: string; deltaTokens: number; deltaCents: number }) => void,
    ): (() => void) => {
      const handler = (
        _event: unknown,
        payload: { kind: string; agentId: string; deltaTokens: number; deltaCents: number },
      ): void => {
        if (payload.kind !== "costs-new") return;
        cb({
          agentId: payload.agentId,
          deltaTokens: payload.deltaTokens,
          deltaCents: payload.deltaCents,
        });
      };
      ipcRenderer.on(IPC.AGENT_EVENT, handler);
      return () => ipcRenderer.off(IPC.AGENT_EVENT, handler);
    },
  },
```

(Note: `costs-new` is broadcast through the same `IPC.AGENT_EVENT` channel as other agent events. PR-A pushes it via `broadcast(...)` which uses `IPC.AGENT_EVENT`.)

- [ ] **Step 2: Add costs types to env.d.ts**

In `apps/renderer/src/env.d.ts`, extend the imports at top:

```ts
  ActivityEventRow,
  ActivityQueryParams,
  CostsQueryInput,
  CostsQueryResult,
  CostsAggregateTodayResult,
  CostBudgets,
} from "@prospero/shared";
```

Add a `costs` namespace inside the `prospero` interface (right after `activity`):

```ts
      costs: {
        query: (input: CostsQueryInput) => Promise<CostsQueryResult>;
        aggregateToday: (payload: { companyId: string }) => Promise<CostsAggregateTodayResult>;
        getBudgets: () => Promise<CostBudgets>;
        setBudgets: (patch: Partial<CostBudgets>) => Promise<CostBudgets>;
        onNew: (
          cb: (payload: { agentId: string; deltaTokens: number; deltaCents: number }) => void,
        ) => () => void;
      };
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS across main + renderer + shared.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m8-ui): expose costs namespace on window.prospero"
```

---

## Task 5: Budgets zustand store + tests

**Files:**
- Create: `apps/renderer/src/stores/budgets.ts`
- Create: `apps/renderer/src/stores/budgets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/renderer/src/stores/budgets.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useBudgetsStore } from "./budgets.js";

const ipcMock = {
  getBudgets: vi.fn(),
  setBudgets: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (
    globalThis as unknown as {
      window: { prospero: { costs: typeof ipcMock } };
    }
  ).window = {
    prospero: { costs: ipcMock },
  };
  useBudgetsStore.setState({
    budgets: {
      maxTokensPerDayPerAgent: 2_000_000,
      maxTokensPerIssue: 200_000,
      rateLimitWindowTokens: 1_000_000,
      rateLimitWindowHours: 5,
    },
    loaded: false,
  });
});

describe("useBudgetsStore", () => {
  it("load fetches from IPC and marks loaded", async () => {
    ipcMock.getBudgets.mockResolvedValue({
      maxTokensPerDayPerAgent: 500_000,
      maxTokensPerIssue: 100_000,
      rateLimitWindowTokens: 800_000,
      rateLimitWindowHours: 4,
    });
    await useBudgetsStore.getState().load();
    expect(useBudgetsStore.getState().loaded).toBe(true);
    expect(useBudgetsStore.getState().budgets.maxTokensPerDayPerAgent).toBe(500_000);
  });

  it("save patches via IPC and replaces local budgets", async () => {
    ipcMock.setBudgets.mockResolvedValue({
      maxTokensPerDayPerAgent: 100,
      maxTokensPerIssue: 200_000,
      rateLimitWindowTokens: 1_000_000,
      rateLimitWindowHours: 5,
    });
    await useBudgetsStore.getState().save({ maxTokensPerDayPerAgent: 100 });
    expect(ipcMock.setBudgets).toHaveBeenCalledWith({ maxTokensPerDayPerAgent: 100 });
    expect(useBudgetsStore.getState().budgets.maxTokensPerDayPerAgent).toBe(100);
  });

  it("save surfaces IPC errors as thrown", async () => {
    ipcMock.setBudgets.mockRejectedValue(new Error("[budgets] must be a positive integer"));
    await expect(
      useBudgetsStore.getState().save({ maxTokensPerIssue: -1 }),
    ).rejects.toThrow(/positive integer/i);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm --filter @prospero/renderer test stores/budgets`
Expected: FAIL.

- [ ] **Step 3: Implement the store**

```ts
// apps/renderer/src/stores/budgets.ts
import { create } from "zustand";
import type { CostBudgets } from "@prospero/shared";

const DEFAULTS: CostBudgets = {
  maxTokensPerDayPerAgent: 2_000_000,
  maxTokensPerIssue: 200_000,
  rateLimitWindowTokens: 1_000_000,
  rateLimitWindowHours: 5,
};

type State = {
  budgets: CostBudgets;
  loaded: boolean;
  load: () => Promise<void>;
  save: (patch: Partial<CostBudgets>) => Promise<void>;
};

export const useBudgetsStore = create<State>((set) => ({
  budgets: DEFAULTS,
  loaded: false,
  load: async () => {
    const b = await window.prospero.costs.getBudgets();
    set({ budgets: b, loaded: true });
  },
  save: async (patch) => {
    const next = await window.prospero.costs.setBudgets(patch);
    set({ budgets: next });
  },
}));
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter @prospero/renderer test stores/budgets`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/stores/budgets.ts apps/renderer/src/stores/budgets.test.ts
git commit -m "feat(m8-ui): budgets zustand store"
```

---

## Task 6: `useCostsQuery` hook + tests

**Files:**
- Create: `apps/renderer/src/hooks/useCostsQuery.ts`
- Create: `apps/renderer/src/hooks/useCostsQuery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/renderer/src/hooks/useCostsQuery.test.ts
import { describe, expect, it } from "vitest";
import { buildQueryRange, deriveAgentFilter } from "./useCostsQuery.js";

describe("buildQueryRange", () => {
  it("returns last 7 days from now in UTC milliseconds", () => {
    const now = Date.UTC(2026, 4, 12, 15);
    const range = buildQueryRange("7d", now);
    expect(range.to).toBe(now);
    expect(range.from).toBe(now - 7 * 86_400_000);
  });

  it("returns last 30 days for 30d", () => {
    const now = Date.UTC(2026, 4, 12);
    const range = buildQueryRange("30d", now);
    expect(range.from).toBe(now - 30 * 86_400_000);
  });

  it("returns same-day boundaries for 1d", () => {
    const now = Date.UTC(2026, 4, 12, 8);
    const range = buildQueryRange("1d", now);
    expect(range.to).toBe(now);
    expect(range.from).toBe(now - 86_400_000);
  });
});

describe("deriveAgentFilter", () => {
  it("returns refId when scope is 'agent' and id provided", () => {
    expect(deriveAgentFilter("agent", "ag_1")).toEqual({ scope: "agent", refId: "ag_1" });
  });

  it("returns scope only when refId is empty", () => {
    expect(deriveAgentFilter("agent", "")).toEqual({ scope: "agent" });
  });

  it("returns company scope by default", () => {
    expect(deriveAgentFilter("company", "")).toEqual({ scope: "company" });
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm --filter @prospero/renderer test useCostsQuery`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// apps/renderer/src/hooks/useCostsQuery.ts
// Wraps costs:query with derived state for /costs route. Pure-fn pieces
// (buildQueryRange, deriveAgentFilter) are exported for unit testing without
// React render.

import { useCallback, useEffect, useState } from "react";
import type {
  CostsQueryInput,
  CostsQueryResult,
  CostsQueryScope,
} from "@prospero/shared";

export type DateRange = "1d" | "7d" | "30d";

export type CostsQueryFilters = {
  range: DateRange;
  scope: CostsQueryScope;
  refId: string;
  adapterName: string;
};

export const buildQueryRange = (
  range: DateRange,
  nowMs: number,
): { from: number; to: number } => {
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  return { from: nowMs - days * 86_400_000, to: nowMs };
};

export const deriveAgentFilter = (
  scope: CostsQueryScope,
  refId: string,
): { scope: CostsQueryScope; refId?: string } => {
  if (refId === "") return { scope };
  return { scope, refId };
};

const empty: CostsQueryResult = {
  buckets: [],
  byAgent: [],
  byProject: [],
  total: { tokens: 0, cents: 0 },
};

export const useCostsQuery = (
  companyId: string | null,
  filters: CostsQueryFilters,
): { result: CostsQueryResult; loading: boolean; refresh: () => Promise<void> } => {
  const [result, setResult] = useState<CostsQueryResult>(empty);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (companyId === null) return;
    setLoading(true);
    try {
      const { from, to } = buildQueryRange(filters.range, Date.now());
      const agentFilter = deriveAgentFilter(filters.scope, filters.refId);
      const input: CostsQueryInput = {
        companyId,
        scope: agentFilter.scope,
        from,
        to,
        bucket: "day",
        ...(agentFilter.refId !== undefined ? { refId: agentFilter.refId } : {}),
        ...(filters.adapterName !== "" ? { adapterName: filters.adapterName } : {}),
      };
      const r = await window.prospero.costs.query(input);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }, [companyId, filters.range, filters.scope, filters.refId, filters.adapterName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { result, loading, refresh };
};
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter @prospero/renderer test useCostsQuery`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/hooks/useCostsQuery.ts apps/renderer/src/hooks/useCostsQuery.test.ts
git commit -m "feat(m8-ui): useCostsQuery hook + pure-fn helpers"
```

---

## Task 7: `useCostsToday` + `useCostsStream` hooks (for Dashboard widget + live updates)

**Files:**
- Create: `apps/renderer/src/hooks/useCostsToday.ts`
- Create: `apps/renderer/src/hooks/useCostsStream.ts`

- [ ] **Step 1: Implement useCostsToday**

```ts
// apps/renderer/src/hooks/useCostsToday.ts
// Polls + subscribes to costs:aggregate-today for the Dashboard widget.
// Re-fetches on every costs-new broadcast (debounced 1s by main) so the
// widget stays fresh without polling.

import { useCallback, useEffect, useState } from "react";
import type { CostsAggregateTodayResult } from "@prospero/shared";

const empty: CostsAggregateTodayResult = {
  totalCents: 0,
  totalTokens: 0,
  percentMax: 0,
  byAgent: [],
};

export const useCostsToday = (
  companyId: string | null,
): { data: CostsAggregateTodayResult; loading: boolean; refresh: () => Promise<void> } => {
  const [data, setData] = useState<CostsAggregateTodayResult>(empty);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (companyId === null) return;
    setLoading(true);
    try {
      const r = await window.prospero.costs.aggregateToday({ companyId });
      setData(r);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (companyId === null) return;
    const off = window.prospero.costs.onNew(() => {
      void refresh();
    });
    return off;
  }, [companyId, refresh]);

  return { data, loading, refresh };
};
```

- [ ] **Step 2: Implement useCostsStream**

```ts
// apps/renderer/src/hooks/useCostsStream.ts
// Re-triggers a passed callback when costs-new broadcasts arrive. Used by
// /costs route to refresh the heavy `costs:query` only when something
// actually changed (vs polling).

import { useEffect } from "react";

export const useCostsStream = (callback: () => void): void => {
  useEffect(() => {
    const off = window.prospero.costs.onNew(() => {
      callback();
    });
    return off;
  }, [callback]);
};
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/hooks/useCostsToday.ts apps/renderer/src/hooks/useCostsStream.ts
git commit -m "feat(m8-ui): useCostsToday + useCostsStream hooks"
```

---

## Task 8: Install `recharts` + verify bundle

**Files:** none (just dependency)

- [ ] **Step 1: Install recharts in the renderer workspace**

Run: `pnpm --filter @prospero/renderer add recharts`
Expected: lockfile updated, `recharts` listed in `apps/renderer/package.json` dependencies.

- [ ] **Step 2: Verify it's in package.json**

```bash
cat apps/renderer/package.json
```

Expected: `"recharts": "^2.x.x"` under dependencies.

- [ ] **Step 3: Commit lockfile + package.json**

```bash
git add apps/renderer/package.json pnpm-lock.yaml
git commit -m "feat(m8-ui): add recharts dependency (lazy-loaded in /costs)"
```

---

## Task 9: i18n keys for costs

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`

- [ ] **Step 1: Add nav.costs + costs.* keys to pt-BR.json**

Open `apps/renderer/src/i18n/pt-BR.json`. Find the `"nav": { ... }` block. Add `"costs": "Custos"` between "activity" and the closing brace.

Add a new top-level `"costs": {...}` block (after existing top-level entries, before the final `}`):

```json
"costs": {
  "title": "Custos",
  "subtitle": "Tokens consumidos por agente, projeto e adapter. Soft-stop quando estourar budget.",
  "header": {
    "totalToday": "Hoje",
    "totalRange": "No período",
    "percentMax": "% do limite Max",
    "percentMaxOver": "Acima do limite!"
  },
  "filters": {
    "scope": "Escopo",
    "scopeCompany": "Empresa toda",
    "scopeAgent": "Por agente",
    "scopeProject": "Por projeto",
    "agent": "Agente",
    "project": "Projeto",
    "adapter": "Adapter",
    "adapterAll": "Todos",
    "range": "Período",
    "range1d": "Últimas 24h",
    "range7d": "Últimos 7 dias",
    "range30d": "Últimos 30 dias",
    "clear": "Limpar"
  },
  "chart": {
    "timeSeries": "Tokens por dia",
    "byAgent": "Top 10 agentes",
    "byProject": "Por projeto",
    "noData": "Sem dados no período",
    "legend": {
      "input": "Entrada",
      "output": "Saída",
      "cacheCreate": "Cache (criação)",
      "cacheRead": "Cache (leitura)"
    }
  },
  "table": {
    "title": "Últimos turns",
    "agent": "Agente",
    "model": "Modelo",
    "tokens": "Tokens",
    "cost": "Custo",
    "time": "Quando",
    "empty": "Nenhum turn ainda."
  },
  "empty": "Sem custos registrados ainda. Mande mensagem pra um agente pra começar.",
  "loading": "Carregando…"
},
"dashboard": {
  "placeholder": "Dashboard ainda é stub. Widgets (Recent Activity, Active Agents, Custos hoje, métricas) chegam em M9 — consomem o Activity stream (M7.7 ✅) e Costs (M8).",
  "createDemoCompany": "Criar empresa de demonstração",
  "costsToday": {
    "title": "Custos hoje",
    "viewDetails": "Ver detalhes →",
    "tokens": "tokens",
    "noActivity": "Nenhum custo hoje ainda."
  }
},
"settings": {
  "title": "Configurações",
  "auth": { "...keep existing...": "" },
  "model": { "...keep existing...": "" },
  "workspace": { "...keep existing...": "" },
  "budgets": {
    "title": "Limites de uso (Budgets)",
    "subtitle": "Quando um agente passa do limite, ele pausa sozinho e avisa no Inbox.",
    "maxTokensPerDayPerAgent": "Tokens por dia por agente",
    "maxTokensPerIssue": "Tokens por issue",
    "rateLimitWindowTokens": "Janela de rate limit (tokens)",
    "rateLimitWindowHours": "Janela de rate limit (horas)",
    "save": "Salvar",
    "saved": "Salvo!",
    "reset": "Restaurar padrões",
    "errorPositive": "Precisa ser um número inteiro positivo."
  }
},
"agent": {
  "...keep existing...": "",
  "stats": {
    "turns": "Turns",
    "lastActivity": "Última atividade",
    "tokensIn": "Tokens entrada",
    "tokensOut": "Tokens saída",
    "tokensCache": "Tokens cache",
    "costTotal": "Custo total",
    "spark7d": "Últimos 7 dias",
    "viewInCosts": "Ver no /costs →"
  }
},
"model": {
  "costHint": {
    "cheap": "$ econômico",
    "medium": "$$ médio",
    "expensive": "$$$ caro"
  }
}
```

**Note:** the `"...keep existing...": ""` placeholders above are markers for the engineer — DO NOT keep them. Open the existing `pt-BR.json`, locate the matching nested objects (`settings.auth`, `agent.stats`, etc.), and MERGE the new keys INTO existing nested objects rather than replacing them. The plan can't show the complete current file here without ballooning; the canonical content is in the existing file.

Concrete merge rules:
- `nav.costs` — new key inside existing `nav` object
- `costs.*` — new top-level object
- `dashboard.costsToday` — new nested object inside existing `dashboard`
- `settings.budgets` — new nested object inside existing `settings`
- `agent.stats.*` — ADD `tokensCache`, `costTotal`, `spark7d`, `viewInCosts` to existing `agent.stats`; REMOVE `m8Note` if present (replaced by real data)
- `model.costHint` — new nested object (existing `model` may not exist; create it as new top-level key)

- [ ] **Step 2: Mirror in en-US.json**

Same structure with English translations:

```json
"nav": { ..., "costs": "Costs" }

"costs": {
  "title": "Costs",
  "subtitle": "Tokens consumed per agent, project, adapter. Soft-stop when budget is exceeded.",
  "header": {
    "totalToday": "Today",
    "totalRange": "This period",
    "percentMax": "% of Max limit",
    "percentMaxOver": "Over the limit!"
  },
  "filters": {
    "scope": "Scope",
    "scopeCompany": "Whole company",
    "scopeAgent": "Per agent",
    "scopeProject": "Per project",
    "agent": "Agent",
    "project": "Project",
    "adapter": "Adapter",
    "adapterAll": "All",
    "range": "Range",
    "range1d": "Last 24h",
    "range7d": "Last 7 days",
    "range30d": "Last 30 days",
    "clear": "Clear"
  },
  "chart": {
    "timeSeries": "Tokens per day",
    "byAgent": "Top 10 agents",
    "byProject": "Per project",
    "noData": "No data in this range",
    "legend": {
      "input": "Input",
      "output": "Output",
      "cacheCreate": "Cache (create)",
      "cacheRead": "Cache (read)"
    }
  },
  "table": {
    "title": "Recent turns",
    "agent": "Agent",
    "model": "Model",
    "tokens": "Tokens",
    "cost": "Cost",
    "time": "When",
    "empty": "No turns yet."
  },
  "empty": "No cost data recorded yet. Send a message to an agent to start.",
  "loading": "Loading…"
}

"dashboard.costsToday": {
  "title": "Today's costs",
  "viewDetails": "View details →",
  "tokens": "tokens",
  "noActivity": "No costs today yet."
}

"settings.budgets": {
  "title": "Usage limits (Budgets)",
  "subtitle": "When an agent goes over its limit, it pauses itself and alerts the Inbox.",
  "maxTokensPerDayPerAgent": "Tokens per day per agent",
  "maxTokensPerIssue": "Tokens per issue",
  "rateLimitWindowTokens": "Rate limit window (tokens)",
  "rateLimitWindowHours": "Rate limit window (hours)",
  "save": "Save",
  "saved": "Saved!",
  "reset": "Reset to defaults",
  "errorPositive": "Must be a positive integer."
}

"agent.stats": add:
  "tokensCache": "Cache tokens",
  "costTotal": "Total cost",
  "spark7d": "Last 7 days",
  "viewInCosts": "View in /costs →"

"model.costHint": {
  "cheap": "$ cheap",
  "medium": "$$ medium",
  "expensive": "$$$ expensive"
}
```

- [ ] **Step 3: Verify JSON parses**

Run: `pnpm --filter @prospero/renderer typecheck` (TS will fail-fast if JSON is invalid; also vite parses on dev)

Or: `node -e "require('./apps/renderer/src/i18n/pt-BR.json'); require('./apps/renderer/src/i18n/en-US.json'); console.log('ok')"`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json
git commit -m "feat(m8-ui): i18n keys for costs, budgets, dashboard widget, stats, model hints"
```

---

## Task 10: `CostsHeader` component

**Files:**
- Create: `apps/renderer/src/components/costs/CostsHeader.tsx`

- [ ] **Step 1: Implement the header**

```tsx
// apps/renderer/src/components/costs/CostsHeader.tsx
// Sticky header: total today + %Max progress bar + total in range.

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { CostsAggregateTodayResult, CostsQueryResult } from "@prospero/shared";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = {
  today: CostsAggregateTodayResult;
  rangeTotals: CostsQueryResult["total"];
};

export const CostsHeader: FC<Props> = ({ today, rangeTotals }) => {
  const { t } = useTranslation();
  const pct = Math.min(today.percentMax, 100);
  const over = today.percentMax > 100;
  return (
    <header className="bg-surface-card border border-surface-border rounded-lg p-5 mb-6">
      <div className="flex flex-wrap items-baseline gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">
            {t("costs.header.totalToday")}
          </div>
          <div className="text-2xl font-bold text-brand-dark mt-0.5">
            {formatCents(today.totalCents)}
          </div>
          <div className="text-xs text-ink-muted">
            {formatTokens(today.totalTokens)} {t("dashboard.costsToday.tokens")}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">
            {t("costs.header.totalRange")}
          </div>
          <div className="text-lg font-semibold text-ink mt-0.5">
            {formatCents(rangeTotals.cents)}
          </div>
          <div className="text-xs text-ink-muted">
            {formatTokens(rangeTotals.tokens)} {t("dashboard.costsToday.tokens")}
          </div>
        </div>
        <div className="flex-1 min-w-[180px]">
          <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold mb-1">
            {t("costs.header.percentMax")} — {String(today.percentMax)}%
          </div>
          <div className="h-2 bg-surface-soft rounded overflow-hidden">
            <div
              className={over ? "h-full bg-semantic-danger" : "h-full bg-brand"}
              style={{ width: `${String(pct)}%` }}
            />
          </div>
          {over && (
            <div className="text-[11px] text-semantic-danger mt-1 font-semibold">
              {t("costs.header.percentMaxOver")}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/costs/CostsHeader.tsx
git commit -m "feat(m8-ui): CostsHeader with today total + range total + %Max bar"
```

---

## Task 11: `CostsFilters` component

**Files:**
- Create: `apps/renderer/src/components/costs/CostsFilters.tsx`

- [ ] **Step 1: Implement the filters bar**

```tsx
// apps/renderer/src/components/costs/CostsFilters.tsx
// Scope selector (company / per-agent / per-project) + per-target dropdown +
// adapter filter + date range. All-string state for simplicity (refId="" → no filter).

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Project, CostsQueryScope } from "@prospero/shared";
import type { DateRange, CostsQueryFilters } from "../../hooks/useCostsQuery.js";

type Props = {
  filters: CostsQueryFilters;
  agents: Agent[];
  projects: Project[];
  onChange: (next: CostsQueryFilters) => void;
  onClear: () => void;
};

export const CostsFilters: FC<Props> = ({ filters, agents, projects, onChange, onClear }) => {
  const { t } = useTranslation();
  const setScope = (scope: CostsQueryScope): void => {
    onChange({ ...filters, scope, refId: "" });
  };
  const setRange = (range: DateRange): void => onChange({ ...filters, range });
  const setRefId = (refId: string): void => onChange({ ...filters, refId });
  const setAdapter = (adapterName: string): void => onChange({ ...filters, adapterName });

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-4 mb-6 flex flex-wrap gap-3 items-end">
      <label className="flex flex-col text-xs gap-1">
        <span className="text-ink-soft uppercase tracking-wide">{t("costs.filters.scope")}</span>
        <select
          value={filters.scope}
          onChange={(e) => setScope(e.target.value as CostsQueryScope)}
          className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm"
        >
          <option value="company">{t("costs.filters.scopeCompany")}</option>
          <option value="agent">{t("costs.filters.scopeAgent")}</option>
          <option value="project">{t("costs.filters.scopeProject")}</option>
        </select>
      </label>

      {filters.scope === "agent" && (
        <label className="flex flex-col text-xs gap-1">
          <span className="text-ink-soft uppercase tracking-wide">
            {t("costs.filters.agent")}
          </span>
          <select
            value={filters.refId}
            onChange={(e) => setRefId(e.target.value)}
            className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm min-w-[160px]"
          >
            <option value="">—</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {filters.scope === "project" && (
        <label className="flex flex-col text-xs gap-1">
          <span className="text-ink-soft uppercase tracking-wide">
            {t("costs.filters.project")}
          </span>
          <select
            value={filters.refId}
            onChange={(e) => setRefId(e.target.value)}
            className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm min-w-[160px]"
          >
            <option value="">—</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col text-xs gap-1">
        <span className="text-ink-soft uppercase tracking-wide">{t("costs.filters.adapter")}</span>
        <select
          value={filters.adapterName}
          onChange={(e) => setAdapter(e.target.value)}
          className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm"
        >
          <option value="">{t("costs.filters.adapterAll")}</option>
          <option value="claude-oauth-local">claude-oauth-local</option>
          <option value="claude-api-key-local">claude-api-key-local</option>
          <option value="claude-oauth-remote-docker">claude-oauth-remote-docker</option>
        </select>
      </label>

      <label className="flex flex-col text-xs gap-1">
        <span className="text-ink-soft uppercase tracking-wide">{t("costs.filters.range")}</span>
        <select
          value={filters.range}
          onChange={(e) => setRange(e.target.value as DateRange)}
          className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm"
        >
          <option value="1d">{t("costs.filters.range1d")}</option>
          <option value="7d">{t("costs.filters.range7d")}</option>
          <option value="30d">{t("costs.filters.range30d")}</option>
        </select>
      </label>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto px-3 py-1.5 text-xs text-ink-muted hover:text-brand border border-surface-border rounded hover:border-brand"
      >
        {t("costs.filters.clear")}
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/costs/CostsFilters.tsx
git commit -m "feat(m8-ui): CostsFilters (scope + agent/project + adapter + range)"
```

---

## Task 12: `CostsChartTimeSeries` (recharts AreaChart, stacked)

**Files:**
- Create: `apps/renderer/src/components/costs/CostsChartTimeSeries.tsx`

- [ ] **Step 1: Implement the chart**

```tsx
// apps/renderer/src/components/costs/CostsChartTimeSeries.tsx
// Stacked area: input + output + cache_creation + cache_read tokens per day.
// recharts handles SVG rendering. We import named exports lazily — file lives
// inside the route chunk that's already lazy via React.lazy(Costs).

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import type { CostBucket } from "@prospero/shared";
import { formatTokens } from "../../lib/costs/formatCents.js";

type Props = { buckets: CostBucket[] };

const fmtDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const CostsChartTimeSeries: FC<Props> = ({ buckets }) => {
  const { t } = useTranslation();
  if (buckets.length === 0) {
    return <p className="text-xs text-ink-muted py-12 text-center">{t("costs.chart.noData")}</p>;
  }
  const data = buckets.map((b) => ({
    day: fmtDate(b.bucketStart),
    input: b.inputTokens,
    output: b.outputTokens,
    cacheCreate: b.cacheCreationTokens,
    cacheRead: b.cacheReadTokens,
  }));
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">
        {t("costs.chart.timeSeries")}
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-border)" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v: number) => formatTokens(v)} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v: number) => formatTokens(v)}
            contentStyle={{ fontSize: 12, background: "var(--surface)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="input"
            name={t("costs.chart.legend.input")}
            stackId="1"
            stroke="#1D5DD7"
            fill="#1D5DD7"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="output"
            name={t("costs.chart.legend.output")}
            stackId="1"
            stroke="#16a34a"
            fill="#16a34a"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="cacheCreate"
            name={t("costs.chart.legend.cacheCreate")}
            stackId="1"
            stroke="#FFC520"
            fill="#FFC520"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="cacheRead"
            name={t("costs.chart.legend.cacheRead")}
            stackId="1"
            stroke="#7c3aed"
            fill="#7c3aed"
            fillOpacity={0.4}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (recharts has types built-in).

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/costs/CostsChartTimeSeries.tsx
git commit -m "feat(m8-ui): CostsChartTimeSeries (stacked area, recharts)"
```

---

## Task 13: `CostsChartByAgent` (recharts horizontal bar)

**Files:**
- Create: `apps/renderer/src/components/costs/CostsChartByAgent.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/renderer/src/components/costs/CostsChartByAgent.tsx
// Horizontal bar chart — top 10 agents by total tokens in range.

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { CostAgentTotal } from "@prospero/shared";
import { formatTokens } from "../../lib/costs/formatCents.js";

type Props = { rows: CostAgentTotal[] };

export const CostsChartByAgent: FC<Props> = ({ rows }) => {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return null;
  }
  const data = rows.map((r) => ({
    name: r.agentName,
    tokens: r.tokens,
    cents: r.cents,
  }));
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">{t("costs.chart.byAgent")}</h3>
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-border)" />
          <XAxis type="number" tickFormatter={(v: number) => formatTokens(v)} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
          <Tooltip
            formatter={(v: number) => formatTokens(v)}
            contentStyle={{ fontSize: 12, background: "var(--surface)" }}
          />
          <Bar dataKey="tokens" fill="#1D5DD7" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/renderer/src/components/costs/CostsChartByAgent.tsx
git commit -m "feat(m8-ui): CostsChartByAgent (horizontal bar)"
```

---

## Task 14: `CostsChartByProject` (recharts PieChart)

**Files:**
- Create: `apps/renderer/src/components/costs/CostsChartByProject.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/renderer/src/components/costs/CostsChartByProject.tsx
// Donut chart — token distribution per project. Null projectId becomes
// "Sem projeto" / "No project".

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import type { CostProjectTotal } from "@prospero/shared";
import { formatTokens } from "../../lib/costs/formatCents.js";

type Props = { rows: CostProjectTotal[] };

const COLORS = ["#1D5DD7", "#16a34a", "#FFC520", "#7c3aed", "#5bc4e7", "#e83e1a"];

export const CostsChartByProject: FC<Props> = ({ rows }) => {
  const { t } = useTranslation();
  const visible = rows.filter((r) => r.tokens > 0);
  if (visible.length === 0) return null;
  const data = visible.map((r) => ({
    name: r.projectName ?? t("costs.filters.adapterAll"),
    value: r.tokens,
  }));
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">{t("costs.chart.byProject")}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={90}
            cx="50%"
            cy="50%"
          >
            {data.map((_, i) => (
              <Cell key={String(i)} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number) => formatTokens(v)}
            contentStyle={{ fontSize: 12, background: "var(--surface)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/renderer/src/components/costs/CostsChartByProject.tsx
git commit -m "feat(m8-ui): CostsChartByProject (donut)"
```

---

## Task 15: `CostsTableRecent` component

**Files:**
- Create: `apps/renderer/src/components/costs/CostsTableRecent.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/renderer/src/components/costs/CostsTableRecent.tsx
// Table of agents x tokens x cents (top by tokens in range). The query
// already returns this as byAgent in CostsQueryResult; we just render.
// Per-turn detail is out of scope v1 — would require new IPC for raw rows.

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { CostAgentTotal } from "@prospero/shared";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = { rows: CostAgentTotal[] };

export const CostsTableRecent: FC<Props> = ({ rows }) => {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <p className="text-xs text-ink-muted py-6 text-center">{t("costs.table.empty")}</p>;
  }
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg overflow-hidden">
      <h3 className="text-sm font-semibold text-brand-dark p-4 pb-2">{t("costs.table.title")}</h3>
      <table className="w-full text-sm">
        <thead className="bg-surface-soft text-[10px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-left px-4 py-2 font-semibold">{t("costs.table.agent")}</th>
            <th className="text-right px-4 py-2 font-semibold">{t("costs.table.tokens")}</th>
            <th className="text-right px-4 py-2 font-semibold">{t("costs.table.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agentId} className="border-t border-surface-border">
              <td className="px-4 py-2 text-ink">{r.agentName}</td>
              <td className="px-4 py-2 text-right text-ink-muted tabular-nums">
                {formatTokens(r.tokens)}
              </td>
              <td className="px-4 py-2 text-right text-ink font-semibold tabular-nums">
                {formatCents(r.cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/renderer/src/components/costs/CostsTableRecent.tsx
git commit -m "feat(m8-ui): CostsTableRecent (agent x tokens x cost)"
```

---

## Task 16: `Costs.tsx` route — assembles everything

**Files:**
- Create: `apps/renderer/src/routes/Costs.tsx`

- [ ] **Step 1: Implement the route**

```tsx
// apps/renderer/src/routes/Costs.tsx
// /costs route — wires header + filters + charts + table to PR-A IPCs.
// This whole file is in the lazy chunk loaded by React.lazy in App.tsx.

import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useAgentsStore } from "../stores/agents.js";
import { useProjectsStore } from "../stores/projects.js";
import {
  useCostsQuery,
  type CostsQueryFilters,
} from "../hooks/useCostsQuery.js";
import { useCostsToday } from "../hooks/useCostsToday.js";
import { useCostsStream } from "../hooks/useCostsStream.js";
import { fillMissingDays } from "../lib/costs/bucketByDay.js";
import { CostsHeader } from "../components/costs/CostsHeader.js";
import { CostsFilters } from "../components/costs/CostsFilters.js";
import { CostsChartTimeSeries } from "../components/costs/CostsChartTimeSeries.js";
import { CostsChartByAgent } from "../components/costs/CostsChartByAgent.js";
import { CostsChartByProject } from "../components/costs/CostsChartByProject.js";
import { CostsTableRecent } from "../components/costs/CostsTableRecent.js";

const useCompanyId = (): string | null => {
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const companies = await window.prospero.companies.list();
      if (companies.length > 0) setCompanyId(companies[0]!.id);
    })();
  }, []);
  return companyId;
};

const DEFAULT_FILTERS: CostsQueryFilters = {
  range: "7d",
  scope: "company",
  refId: "",
  adapterName: "",
};

export const Costs: FC = () => {
  const { t } = useTranslation();
  const companyId = useCompanyId();
  const agents = useAgentsStore((s) => s.agents);
  const projects = useProjectsStore((s) => s.projects);

  const [filters, setFilters] = useState<CostsQueryFilters>(DEFAULT_FILTERS);
  const { result, loading, refresh } = useCostsQuery(companyId, filters);
  const { data: today } = useCostsToday(companyId);
  useCostsStream(refresh);

  const paddedBuckets = useMemo(() => {
    if (result.buckets.length === 0) return [];
    const sorted = [...result.buckets].sort((a, b) => a.bucketStart - b.bucketStart);
    const first = sorted[0]!.bucketStart;
    const last = sorted[sorted.length - 1]!.bucketStart + 86_400_000;
    return fillMissingDays(sorted, first, last);
  }, [result.buckets]);

  if (companyId === null) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-brand-dark mb-1">{t("costs.title")}</h1>
        <p className="text-sm text-ink-muted">{t("costs.empty")}</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-1">{t("costs.title")}</h1>
      <p className="text-sm text-ink-muted mb-4">{t("costs.subtitle")}</p>

      <CostsHeader today={today} rangeTotals={result.total} />

      <CostsFilters
        filters={filters}
        agents={agents}
        projects={projects}
        onChange={setFilters}
        onClear={() => setFilters(DEFAULT_FILTERS)}
      />

      {loading && result.buckets.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("costs.loading")}</p>
      ) : (
        <>
          <CostsChartTimeSeries buckets={paddedBuckets} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CostsChartByAgent rows={result.byAgent} />
            <CostsChartByProject rows={result.byProject} />
          </div>
          <CostsTableRecent rows={result.byAgent} />
        </>
      )}
    </div>
  );
};

export default Costs;
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/renderer/src/routes/Costs.tsx
git commit -m "feat(m8-ui): /costs route assembling header + filters + 3 charts + table"
```

---

## Task 17: App.tsx — lazy `/costs` route + NavLink

**Files:**
- Modify: `apps/renderer/src/App.tsx`

- [ ] **Step 1: Replace the Activity static import with lazy + import Costs lazily**

In `apps/renderer/src/App.tsx`, REMOVE the line:

```ts
import { Activity } from "./routes/Activity.js";
```

And ADD at top (after the static imports):

```ts
import { lazy, Suspense } from "react";

const Activity = lazy(() =>
  import("./routes/Activity.js").then((m) => ({ default: m.Activity })),
);
const Costs = lazy(() => import("./routes/Costs.js"));
```

- [ ] **Step 2: Add NavLink for Costs between Skills and Activity**

In the `<Sidebar>` JSX, find the existing block for `/activity` (around line 97) and insert this BEFORE it:

```tsx
        <NavLink
          to="/costs"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.costs")}
        </NavLink>
```

- [ ] **Step 3: Wrap routes that use lazy components in Suspense**

Find the `<Route path="/activity" ...>` and replace its element with a Suspense wrapper:

```tsx
          <Route
            path="/activity"
            element={
              hasToken ? (
                <Layout>
                  <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                    <Activity />
                  </Suspense>
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
```

Add a NEW Route for `/costs` right after `/activity`:

```tsx
          <Route
            path="/costs"
            element={
              hasToken ? (
                <Layout>
                  <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                    <Costs />
                  </Suspense>
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/App.tsx
git commit -m "feat(m8-ui): /costs route lazy-loaded + sidebar NavLink"
```

---

## Task 18: `CostsTodayWidget` → Dashboard

**Files:**
- Create: `apps/renderer/src/components/costs/CostsTodayWidget.tsx`
- Modify: `apps/renderer/src/routes/Dashboard.tsx`

- [ ] **Step 1: Implement the widget**

```tsx
// apps/renderer/src/components/costs/CostsTodayWidget.tsx
// Lightweight widget for the Dashboard route. Subscribes to costs-new
// broadcasts so the number updates live without polling.

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCostsToday } from "../../hooks/useCostsToday.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = { companyId: string | null };

export const CostsTodayWidget: FC<Props> = ({ companyId }) => {
  const { t } = useTranslation();
  const { data } = useCostsToday(companyId);
  const over = data.percentMax > 100;
  const pct = Math.min(data.percentMax, 100);

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5 max-w-md">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.costsToday.title")}
        </h3>
        <Link to="/costs" className="text-xs text-brand hover:underline">
          {t("dashboard.costsToday.viewDetails")}
        </Link>
      </div>
      {data.totalTokens === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.costsToday.noActivity")}</p>
      ) : (
        <>
          <div className="text-3xl font-bold text-brand-dark">{formatCents(data.totalCents)}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {formatTokens(data.totalTokens)} {t("dashboard.costsToday.tokens")}
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold mb-1">
              {t("costs.header.percentMax")} — {String(data.percentMax)}%
            </div>
            <div className="h-1.5 bg-surface-soft rounded overflow-hidden">
              <div
                className={over ? "h-full bg-semantic-danger" : "h-full bg-brand"}
                style={{ width: `${String(pct)}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Render widget in Dashboard**

Modify `apps/renderer/src/routes/Dashboard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { CostsTodayWidget } from "../components/costs/CostsTodayWidget.js";

export const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const loadAgents = useAgentsStore((s) => s.load);
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const companies = await window.prospero.companies.list();
      if (companies.length > 0) setCompanyId(companies[0]!.id);
    })();
  }, []);

  const onCreateDemo = async () => {
    const company = await window.prospero.companies.createDemo();
    await loadAgents(company.id);
    const updated = useAgentsStore.getState().agents;
    if (updated.length > 0) navigate(`/agents/${updated[0]!.id}`);
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">{t("app.title")}</h1>
        <p className="text-ink-muted mt-2">{t("dashboard.placeholder")}</p>
      </div>
      {companyId !== null && <CostsTodayWidget companyId={companyId} />}
      {agents.length === 0 && (
        <button
          onClick={() => void onCreateDemo()}
          className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded"
          type="button"
        >
          {t("dashboard.createDemoCompany")}
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add apps/renderer/src/components/costs/CostsTodayWidget.tsx apps/renderer/src/routes/Dashboard.tsx
git commit -m "feat(m8-ui): Dashboard 'Custos hoje' widget wired to aggregateToday"
```

---

## Task 19: `BudgetsForm` → Settings

**Files:**
- Create: `apps/renderer/src/components/costs/BudgetsForm.tsx`
- Modify: `apps/renderer/src/routes/Settings.tsx`

- [ ] **Step 1: Implement BudgetsForm**

```tsx
// apps/renderer/src/components/costs/BudgetsForm.tsx
// Inline-editable form for the 4 budget caps. Validation is server-side
// (PR-A throws on non-positive-int); we surface the error inline.

import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useBudgetsStore } from "../../stores/budgets.js";

const FIELDS = [
  "maxTokensPerDayPerAgent",
  "maxTokensPerIssue",
  "rateLimitWindowTokens",
  "rateLimitWindowHours",
] as const;
type Field = (typeof FIELDS)[number];

export const BudgetsForm: FC = () => {
  const { t } = useTranslation();
  const budgets = useBudgetsStore((s) => s.budgets);
  const loaded = useBudgetsStore((s) => s.loaded);
  const load = useBudgetsStore((s) => s.load);
  const save = useBudgetsStore((s) => s.save);

  const [drafts, setDrafts] = useState<Record<Field, string>>({
    maxTokensPerDayPerAgent: "",
    maxTokensPerIssue: "",
    rateLimitWindowTokens: "",
    rateLimitWindowHours: "",
  });
  const [errors, setErrors] = useState<Record<Field, string | null>>({
    maxTokensPerDayPerAgent: null,
    maxTokensPerIssue: null,
    rateLimitWindowTokens: null,
    rateLimitWindowHours: null,
  });
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loaded) {
      setDrafts({
        maxTokensPerDayPerAgent: String(budgets.maxTokensPerDayPerAgent),
        maxTokensPerIssue: String(budgets.maxTokensPerIssue),
        rateLimitWindowTokens: String(budgets.rateLimitWindowTokens),
        rateLimitWindowHours: String(budgets.rateLimitWindowHours),
      });
    }
  }, [loaded, budgets]);

  const onSave = async (field: Field): Promise<void> => {
    const raw = drafts[field];
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      setErrors((e) => ({ ...e, [field]: t("settings.budgets.errorPositive") }));
      return;
    }
    setErrors((e) => ({ ...e, [field]: null }));
    try {
      await save({ [field]: n });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setErrors((e) => ({ ...e, [field]: (err as Error).message }));
    }
  };

  const onReset = async (): Promise<void> => {
    await save({
      maxTokensPerDayPerAgent: 2_000_000,
      maxTokensPerIssue: 200_000,
      rateLimitWindowTokens: 1_000_000,
      rateLimitWindowHours: 5,
    });
  };

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-1">
        {t("settings.budgets.title")}
      </h2>
      <p className="text-xs text-ink-muted mb-3">{t("settings.budgets.subtitle")}</p>
      <dl className="space-y-3">
        {FIELDS.map((field) => (
          <div key={field}>
            <dt className="text-xs text-ink-muted mb-1">{t(`settings.budgets.${field}`)}</dt>
            <dd className="flex gap-2 items-center">
              <input
                type="number"
                min="1"
                step="1"
                value={drafts[field]}
                onChange={(e) => setDrafts((d) => ({ ...d, [field]: e.target.value }))}
                onBlur={() => void onSave(field)}
                className="px-3 py-1.5 bg-surface-soft border border-surface-border rounded text-sm font-mono w-48"
              />
              {errors[field] !== null && (
                <span className="text-xs text-semantic-danger">{errors[field]}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex gap-3 items-center">
        <button
          type="button"
          onClick={() => void onReset()}
          className="text-xs text-ink-muted hover:text-brand underline"
        >
          {t("settings.budgets.reset")}
        </button>
        {savedFlash && (
          <span className="text-xs text-semantic-success">{t("settings.budgets.saved")}</span>
        )}
      </div>
    </section>
  );
};
```

- [ ] **Step 2: Add the section to Settings.tsx**

In `apps/renderer/src/routes/Settings.tsx`, add the import at top:

```ts
import { BudgetsForm } from "../components/costs/BudgetsForm.js";
```

Insert `<BudgetsForm />` between the model section and the workspace section. The relevant region is around lines 92–108; place `<BudgetsForm />` before the `<section className="mb-6">` that holds the workspace deprecated note:

```tsx
      </section>

      <BudgetsForm />

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-brand-dark mb-2">
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add apps/renderer/src/components/costs/BudgetsForm.tsx apps/renderer/src/routes/Settings.tsx
git commit -m "feat(m8-ui): Settings Budgets section with inline-edit + reset"
```

---

## Task 20: ModelDropdown cost hints

**Files:**
- Modify: `apps/renderer/src/components/ModelDropdown.tsx`

- [ ] **Step 1: Add cost hint chips next to each preset**

Replace the contents of `apps/renderer/src/components/ModelDropdown.tsx` with:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { CLAUDE_MODEL_PRESETS, MODEL_ID_REGEX } from "@prospero/shared";
import { categorizeCostTier, type CostTier } from "../lib/costs/categorizeCostTier.js";

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

const CUSTOM = "__custom__";

const tierClass = (tier: CostTier): string => {
  switch (tier) {
    case "cheap":
      return "text-semantic-success";
    case "medium":
      return "text-brand";
    case "expensive":
      return "text-semantic-warning";
    default:
      return "text-ink-soft";
  }
};

const tierLabel = (
  tier: CostTier,
  t: ReturnType<typeof useTranslation>["t"],
): string => {
  if (tier === "cheap") return t("model.costHint.cheap");
  if (tier === "medium") return t("model.costHint.medium");
  if (tier === "expensive") return t("model.costHint.expensive");
  return "";
};

export const ModelDropdown: FC<Props> = ({ value, onChange, disabled = false }) => {
  const { t } = useTranslation();
  const isPreset = (CLAUDE_MODEL_PRESETS as readonly string[]).includes(value);
  const [selectValue, setSelectValue] = useState<string>(isPreset ? value : CUSTOM);
  const [customValue, setCustomValue] = useState<string>(isPreset ? "" : value);
  const [error, setError] = useState<string | null>(null);

  const onSelect = (next: string): void => {
    setSelectValue(next);
    setError(null);
    if (next === CUSTOM) return;
    onChange(next);
  };

  const onCustomBlur = (): void => {
    if (selectValue !== CUSTOM) return;
    const trimmed = customValue.trim();
    if (trimmed === "" || !MODEL_ID_REGEX.test(trimmed)) {
      setError(t("settings.model.invalid"));
      return;
    }
    setError(null);
    onChange(trimmed);
  };

  const selectedTier = categorizeCostTier(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <select
          value={selectValue}
          onChange={(e) => onSelect(e.target.value)}
          disabled={disabled}
          className="flex-1 px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm"
        >
          <option value="claude-opus-4-7">{t("settings.model.presetOpus")}</option>
          <option value="claude-sonnet-4-6">{t("settings.model.presetSonnet")}</option>
          <option value="claude-haiku-4-5-20251001">{t("settings.model.presetHaiku")}</option>
          <option value={CUSTOM}>{t("settings.model.custom")}</option>
        </select>
        {selectedTier.symbol !== "" && (
          <span
            className={`text-xs font-mono font-semibold ${tierClass(selectedTier.tier)}`}
            title={tierLabel(selectedTier.tier, t)}
          >
            {selectedTier.symbol}
          </span>
        )}
      </div>
      {selectValue === CUSTOM && (
        <input
          type="text"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onBlur={onCustomBlur}
          placeholder={t("settings.model.customPlaceholder")}
          disabled={disabled}
          className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
        />
      )}
      {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/renderer/src/components/ModelDropdown.tsx
git commit -m "feat(m8-ui): ModelDropdown cost tier hint (\$/\$\$/\$\$\$)"
```

---

## Task 21: StatsTab — real cost data

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/StatsTab.tsx`

- [ ] **Step 1: Replace placeholder with real cost query**

Rewrite `apps/renderer/src/components/agent-panel/StatsTab.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { AgentStats } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { useCostsQuery } from "../../hooks/useCostsQuery.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = { agentId: string };

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString();
};

const useCompanyId = (): string | null => {
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const companies = await window.prospero.companies.list();
      if (companies.length > 0) setCompanyId(companies[0]!.id);
    })();
  }, []);
  return companyId;
};

export const StatsTab: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const fetchStats = useAgentsStore((s) => s.fetchStats);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const companyId = useCompanyId();
  const { result } = useCostsQuery(companyId, {
    range: "7d",
    scope: "agent",
    refId: agentId,
    adapterName: "",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await fetchStats(agentId);
      if (!cancelled) setStats(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, fetchStats]);

  const sumByKey = (key: "inputTokens" | "outputTokens"): number =>
    result.buckets.reduce((acc, b) => acc + b[key], 0);
  const sumCache = (): number =>
    result.buckets.reduce((acc, b) => acc + b.cacheCreationTokens + b.cacheReadTokens, 0);

  if (stats === null) {
    return <div className="p-4 text-xs text-ink-muted">…</div>;
  }
  return (
    <div className="p-4 space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-[10px] uppercase text-ink-soft font-semibold">
            {t("agent.stats.turns")}
          </dt>
          <dd className="text-lg font-bold text-brand-dark mt-0.5">{stats.turns}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-ink-soft font-semibold">
            {t("agent.stats.lastActivity")}
          </dt>
          <dd className="text-[11px] text-ink mt-1.5">{formatTimestamp(stats.lastActivityAt)}</dd>
        </div>
      </dl>
      <div className="border-t border-surface-border pt-3">
        <div className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.stats.spark7d")}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-[10px] uppercase text-ink-soft font-semibold">
              {t("agent.stats.tokensIn")}
            </dt>
            <dd className="text-base font-bold text-ink mt-0.5 tabular-nums">
              {formatTokens(sumByKey("inputTokens"))}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-ink-soft font-semibold">
              {t("agent.stats.tokensOut")}
            </dt>
            <dd className="text-base font-bold text-ink mt-0.5 tabular-nums">
              {formatTokens(sumByKey("outputTokens"))}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-ink-soft font-semibold">
              {t("agent.stats.tokensCache")}
            </dt>
            <dd className="text-base font-bold text-ink-muted mt-0.5 tabular-nums">
              {formatTokens(sumCache())}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-ink-soft font-semibold">
              {t("agent.stats.costTotal")}
            </dt>
            <dd className="text-base font-bold text-brand-dark mt-0.5 tabular-nums">
              {formatCents(result.total.cents)}
            </dd>
          </div>
        </dl>
      </div>
      <Link to="/costs" className="text-xs text-brand hover:underline block">
        {t("agent.stats.viewInCosts")}
      </Link>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/renderer/src/components/agent-panel/StatsTab.tsx
git commit -m "feat(m8-ui): StatsTab shows real 7d tokens + cost from costs:query"
```

---

## Task 22: Final pass — full suite + bundle check

**Files:** none (verification)

- [ ] **Step 1: Run lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: 443 main + ~50+ renderer (was 43, added ~10 from pure-fn + store). All green.

- [ ] **Step 3: Build renderer and check bundle**

Run: `pnpm --filter @prospero/renderer build`
Expected: build success. Vite output reports chunk sizes. Main bundle should be near 397 kB (M7.6 baseline). The `/costs` route + recharts go in a separate lazy chunk; its size will be ~150–200 kB (recharts) + small wiring.

If main bundle delta > +30 kB uncompressed, investigate (likely a static import leaked recharts into main).

- [ ] **Step 4: Manual smoke**

Run: `pnpm dev`
Manually verify:
1. App boots, sidebar shows "Custos" between "Habilidades" and "Atividade"
2. Click `/costs`: page renders with empty state (no data yet)
3. Send 2-3 messages to CEO → return to `/costs`: bucket appears in chart, table populates
4. Open Settings → Budgets section visible, set daily cap to 100 → next CEO turn pauses agent + inbox security_alert shows
5. Reset budget to 2_000_000
6. Dashboard "Custos hoje" widget shows live total
7. StatsTab on /agents/:id shows real tokens (not "—")
8. Settings → Model dropdown shows $/$$/$$$ next to selected
9. Toggle pt-BR ↔ en-US — no untranslated strings on /costs
10. Toggle theme — charts legible in both

- [ ] **Step 5: Final commit**

```bash
git status
git log --oneline master..HEAD
```

Expected: 18+ commits on PR-B branch, all green. Open PR or merge to master via fast-forward (per M8 PR-A pattern).

---

## Spec coverage self-review

| Spec section | Covered by |
|---|---|
| §8.1 `/costs` route | Tasks 10–17 |
| §8.2 Dashboard widget | Task 18 |
| §8.3 StatsTab | Task 21 |
| §8.4 Settings Budgets | Task 19 |
| §8.5 ModelDropdown hints | Task 20 |
| §8.6 i18n PT/EN keys | Task 9 |
| §3.7 recharts lazy-loaded | Tasks 8 + 17 (lazy route + recharts only imported inside `/costs` chunk) |
| §3.8 4 budget settings via IPC | Tasks 4, 5, 19 |
| §3.6 %Max progress bar | Tasks 10, 18 |
| §7 4 IPC handlers from PR-A | Task 4 (expose to renderer) |
| §10.3 renderer pure-fn tests | Tasks 1, 2, 3, 5, 6 (8+6+5+3+5 = 27 new tests in renderer) |
| Non-regression bundle ≤ +5 kB main | Task 22 verification |

PR-A out-of-scope items remain out: per-issue UI surfacing (M8.5 will add), rate_limit_event real parsing, multi-currency.

## Placeholder scan

Searched for "TBD", "TODO", "implement later", "add appropriate error handling", "fill in details", "Similar to Task N". None found.

Task 9 ("i18n keys") deliberately uses placeholder comments like `"...keep existing...": ""` to mark merge points; explicit guidance in the same step tells the engineer to merge into existing nested objects rather than copy-paste literally. This is intentional — the alternative (showing full pt-BR.json contents) would make the plan ~50% longer with content the engineer can read from the file directly.

## Type consistency

- `CostsQueryFilters` shape (`range`, `scope`, `refId`, `adapterName`) consistent across Tasks 6, 11, 16, 21.
- `CostBudgets` field names (4 keys) consistent across Tasks 4, 5, 9, 19.
- `categorizeCostTier` return shape (`{ tier, symbol }`) consistent across Tasks 3, 20.
- `CostBucket` typed reads (`inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `costCents`) match PR-A shared types — verified Task 1, 12, 21.
- `CostsAggregateTodayResult` shape (`totalCents`, `totalTokens`, `percentMax`, `byAgent`) consistent across Tasks 7, 10, 18.

---

**Plan complete.** Saved to `docs/superpowers/plans/2026-05-12-m8-pr-b-costs-ui.md`.

## Execution Handoff

**Two execution options:**

1. **Inline Execution (recommended)** — execute tasks in this session using executing-plans, checkpoints between phases. M7.6 lessons + M8 PR-A experience say inline > subagent-driven for mechanical TDD-style plans like this one.
2. **Subagent-Driven** — fresh subagent per task, two-stage review. Higher review overhead, useful if you want a fresh-eyes review between tasks.
