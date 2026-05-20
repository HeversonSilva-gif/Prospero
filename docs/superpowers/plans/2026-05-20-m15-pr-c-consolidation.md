# M15 PR-C — Routines Consolidação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o M15. Painel de Histórico colapsável em `/routines/:id` (reusa `activity:query` do M7.7) + polish (dead i18n keys, `setTimeout` cleanup, widen `TFunction`, extrair `formatRelative`) + docs (SECURITY.md, roadmap.html, ROADMAP.md).

**Architecture:** Renderer-only. Zero IPC novo, zero schema, zero migration. Hist é um `<RoutineHistory>` que despacha `window.prospero.activity.query` com filtros `entityKind: "routine"` + `entityId`. `<RoutineHistoryRow>` renderiza cada linha. Polish é cleanup direcionado em 2 componentes + 1 lib + 2 JSONs.

**Tech Stack:** React 18 · TypeScript strict · react-i18next · Tailwind · zustand (existente, sem alterações) · IPC bridge `window.prospero.activity.query` (M7.7, sem mudança). Window bridge confirmado em `apps/main/src/ipc/preload.ts:376-378`.

**Spec:** `docs/superpowers/specs/2026-05-20-m15-pr-c-consolidation-design.md` (commit `afeaa4d`). Base: HEAD `afeaa4d` (M15 PR-B close + spec commit).

---

## File map

**Criados (renderer, 2):**
- `apps/renderer/src/components/routines/RoutineHistoryRow.tsx` — linha individual (bolinha + status + chip de reason + timestamp).
- `apps/renderer/src/components/routines/RoutineHistory.tsx` — seção colapsável (header com contador + botão refresh + lista de rows).

**Modificados (renderer, 6):**
- `apps/renderer/src/lib/routines/format-summary.ts` — importa `TFunction` de `i18next` (type-only), exporta `formatRelative` (movido de RoutineRow).
- `apps/renderer/src/lib/routines/format-summary.test.ts` — +3 testes para `formatRelative`.
- `apps/renderer/src/components/routines/RoutineRow.tsx` — remove cast `as unknown as TFunction`, importa `formatRelative` da lib, `setTimeout` via `useRef` + `useEffect` cleanup.
- `apps/renderer/src/routes/RoutineForm.tsx` — `setTimeout` via `useRef` + `useEffect` cleanup; integra `<RoutineHistory />` abaixo do form em edit mode.
- `apps/renderer/src/i18n/en-US.json` — remove `routines.empty.cta`/`empty.title`; +13 keys de `routines.history.*`.
- `apps/renderer/src/i18n/pt-BR.json` — idem.

**Modificados (docs, 3):**
- `SECURITY.md` — nova seção "Routines (M15)" (~25 linhas).
- `docs/roadmap.html` — bullet Routines passa de "em construção" pra ✅ com copy leigo.
- `ROADMAP.md` — fecha M15 (3/3) e atualiza Status atual.

**Total:** 2 criados + 9 modificados = 11 arquivos.

---

## Conventions

- Sempre rodar `pnpm typecheck` antes de commitar — vitest com esbuild não pega type holes (lesson [[project-m14-pr-a-lessons]]).
- Antes do commit final de cada task: `git status --short` + `git diff HEAD --stat` para confirmar disk == staged == HEAD.
- Pre-commit hook reformata (prettier) + eslint-fix + gitleaks. Warning CRLF no Windows — inofensivo.
- Commits lowercase, sem `+`/`%`, ≤72 chars (commitlint).
- Nunca `--no-verify`.
- Renderer-only — zero mudança em `apps/main/`.
- Sem emojis na UI (regra hard do usuário [[feedback-no-emojis]]) — SVG inline ou texto.

### Comandos

Pasta raiz: `D:\Projetos pessoais\DashboardAgent`. PowerShell.

- Tests renderer único: `cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"; npx vitest run <relative-path>`
- Tests full renderer: `pnpm --filter @prospero/renderer test`
- Typecheck workspace: `pnpm typecheck`
- Lint: `pnpm lint`

---

## Task 1: i18n keys (remoção + adição)

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

Context: dead keys `routines.empty.cta` + `routines.empty.title` foram adicionadas no PR-B mas o `EmptyState` primitivo só aceita `message` + `icon` — nunca foram usadas. PR-C remove. Em paralelo, PR-C adiciona 13 chaves novas em `routines.history.*` para o painel de Histórico. i18next interpolation usa `{{name}}` (double curly). Parity test em `apps/renderer/src/i18n/parity.test.ts` valida simetria.

- [ ] **Step 1: Remove dead keys + add history keys in `en-US.json`**

Open `apps/renderer/src/i18n/en-US.json`. Find the `"empty"` block inside `"routines"`. Replace it from:

```json
    "empty": {
      "title": "No routines yet",
      "description": "Create the first one so an agent wakes on its own — on a schedule or in response to an event.",
      "cta": "Create first routine"
    },
```

to:

```json
    "empty": {
      "description": "Create the first one so an agent wakes on its own — on a schedule or in response to an event."
    },
```

(Keeping only `description`, which IS used by `Routines.tsx`.)

Then, immediately after the `"summary"` block in `routines`, add a new `"history"` block:

```json
    "history": {
      "title": "Fire history",
      "empty": "This routine has never fired",
      "refresh": "Refresh",
      "expand": "Expand",
      "collapse": "Collapse",
      "status": {
        "fired": "Fired",
        "skipped": "Skipped"
      },
      "reason": {
        "scheduled": "scheduled",
        "catchup": "catch-up",
        "event": "event-triggered",
        "manual": "manual",
        "agent_unavailable": "agent unavailable",
        "budget_paused": "budget paused"
      }
    },
```

(Add a comma after the `"summary"` closing `}` if there isn't one already.)

- [ ] **Step 2: Mirror the changes in `pt-BR.json`**

Open `apps/renderer/src/i18n/pt-BR.json`. Replace the `"empty"` block from:

```json
    "empty": {
      "title": "Nenhuma routine ainda",
      "description": "Crie a primeira para que um agente acorde sozinho em horário ou por evento.",
      "cta": "Criar primeira routine"
    },
```

to:

```json
    "empty": {
      "description": "Crie a primeira para que um agente acorde sozinho em horário ou por evento."
    },
```

Then add after the `"summary"` block:

```json
    "history": {
      "title": "Histórico de disparos",
      "empty": "Esta routine nunca disparou",
      "refresh": "Atualizar",
      "expand": "Expandir",
      "collapse": "Colapsar",
      "status": {
        "fired": "Disparada",
        "skipped": "Pulada"
      },
      "reason": {
        "scheduled": "agendada",
        "catchup": "atrasada (catch-up)",
        "event": "por evento",
        "manual": "manual",
        "agent_unavailable": "agente indisponível",
        "budget_paused": "orçamento pausado"
      }
    },
```

- [ ] **Step 3: Run parity test + typecheck**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/i18n/parity.test.ts
```

Expected: pass (en/pt simetricos).

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm --filter @prospero/renderer test
```

Expected: all green. Test count unchanged.

- [ ] **Step 4: Commit**

```powershell
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(routines): add history i18n keys and remove dead empty keys"
```

---

## Task 2: Widen `TFunction` + extract `formatRelative` + tests

**Files:**
- Modify: `apps/renderer/src/lib/routines/format-summary.ts`
- Modify: `apps/renderer/src/lib/routines/format-summary.test.ts`

Context: hoje `TFunction` é declarado localmente como `(key: string, params?: Record<string, string | number>) => string`. Isso não é compatível com o `t` que `useTranslation()` retorna → exige cast `as unknown as TFunction` em RoutineRow (lição do PR-B Task 7). Fix: importar o `TFunction` real de `i18next` (type-only — não adiciona runtime). `formatRelative` hoje vive privado em `RoutineRow.tsx` (linha 19) e vai ser usado por `RoutineHistoryRow` — extrair para o lib.

- [ ] **Step 1: Write the failing tests for `formatRelative`**

Open `apps/renderer/src/lib/routines/format-summary.test.ts`. At the end of the file (after the last `describe` block, before the closing of the file), add:

```typescript
describe("formatRelative", () => {
  it("null timestamp returns the neverLabel", () => {
    expect(formatRelative(null, "never")).toBe("never");
  });

  it("today's timestamp returns HH:MM string", () => {
    const now = new Date();
    const todayAt0915 = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      9,
      15,
      0,
      0,
    ).getTime();
    expect(formatRelative(todayAt0915, "—")).toBe("09:15");
  });

  it("non-today timestamp returns a locale date string", () => {
    // Fixed past date — January 15, 2025 at 14:30 local.
    const past = new Date(2025, 0, 15, 14, 30, 0, 0).getTime();
    const result = formatRelative(past, "—");
    // Not "14:30" (would be the today branch). Locale-dependent, so just
    // assert it isn't the HH:MM form by checking it contains a date marker.
    expect(result).not.toBe("14:30");
    expect(result.length).toBeGreaterThan(0);
  });
});
```

And update the imports at the top of the test file to include `formatRelative`:

```typescript
import {
  formatScheduleSummary,
  formatEventSummary,
  parseAtMinute,
  formatAtMinute,
  formatRelative,
} from "./format-summary.js";
```

- [ ] **Step 2: Run, see fail**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/lib/routines/format-summary.test.ts
```

Expected: FAIL — `formatRelative` import not resolved.

- [ ] **Step 3: Modify `format-summary.ts` — widen `TFunction` + add `formatRelative`**

Open `apps/renderer/src/lib/routines/format-summary.ts`. Replace the entire `TFunction` type alias declaration with a type-only import from `i18next`:

Find:

```typescript
export type TFunction = (key: string, params?: Record<string, string | number>) => string;
```

Replace with:

```typescript
import type { TFunction } from "i18next";

export type { TFunction };
```

(The `export type { TFunction }` re-exports it from the lib so existing callers like `RoutineRow.tsx` that import `TFunction` from `./format-summary.js` keep working.)

Adjust the existing top-of-file imports so the new `import type` lives with them — final order:

```typescript
import type { TFunction } from "i18next";
import type { EventSpec, RoutineEventType, ScheduleSpec } from "@prospero/shared";

export type { TFunction };
```

(Keep the other imports/exports below as-is.)

Then, at the bottom of `format-summary.ts` (after `eventLabelKey`), add `formatRelative`:

```typescript
export const formatRelative = (ts: number | null, neverLabel: string): string => {
  if (ts === null) return neverLabel;
  const d = new Date(ts);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return formatAtMinute(d.getHours() * 60 + d.getMinutes());
  }
  return d.toLocaleDateString();
};
```

- [ ] **Step 4: Run the tests — confirm pass**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/lib/routines/format-summary.test.ts
```

Expected: all tests in this file pass (previous 16 + 3 new = 19 `it` blocks).

- [ ] **Step 5: Typecheck full workspace**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
```

Expected: green. The widened `TFunction` (now the real i18next one) is structurally a superset of the previous local one, so existing callers (`formatScheduleSummary`, `formatEventSummary`) still type-check. The cast in RoutineRow.tsx is NOT removed yet (Task 3 handles that).

- [ ] **Step 6: Commit**

```powershell
git add apps/renderer/src/lib/routines/format-summary.ts apps/renderer/src/lib/routines/format-summary.test.ts
git commit -m "refactor(routines): widen tfunction and extract formatRelative"
```

---

## Task 3: Cleanup `RoutineRow.tsx`

**Files:**
- Modify: `apps/renderer/src/components/routines/RoutineRow.tsx`

Context: three independent cleanups in the same file:
1. Remove the `tRaw as unknown as TFunction` cast — now redundant because `TFunction` IS the i18next one (Task 2).
2. Replace the inline `formatRelative` definition with an import from `format-summary.ts`.
3. Replace `setTimeout(...)` with a `useRef` + `useEffect` cleanup pattern so it doesn't fire on unmounted component.

- [ ] **Step 1: Update imports**

Open `apps/renderer/src/components/routines/RoutineRow.tsx`. The current import block has:

```typescript
import { useState, type FC, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Routine } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import {
  formatScheduleSummary,
  formatEventSummary,
  formatAtMinute,
  type TFunction,
} from "../../lib/routines/format-summary.js";
```

Change to:

```typescript
import { useEffect, useRef, useState, type FC, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Routine } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import {
  formatScheduleSummary,
  formatEventSummary,
  formatRelative,
} from "../../lib/routines/format-summary.js";
```

(`useEffect` + `useRef` added; `formatRelative` imported; `formatAtMinute` removed if not otherwise used; `TFunction` import removed.)

If `formatAtMinute` is referenced anywhere else in this file (it shouldn't be after Step 3 below), keep the import. Otherwise remove.

- [ ] **Step 2: Remove the inline `formatRelative` helper**

Find lines 19-32 (approximately) — the local `formatRelative` declaration. Delete the entire block. It looks like:

```typescript
const formatRelative = (ts: number | null, neverLabel: string): string => {
  if (ts === null) return neverLabel;
  const d = new Date(ts);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return formatAtMinute(d.getHours() * 60 + d.getMinutes());
  }
  return d.toLocaleDateString();
};
```

Delete those 13 lines entirely. (The component below will use the imported `formatRelative`.)

- [ ] **Step 3: Remove the `TFunction` cast**

Find lines (approximately 35-36):

```typescript
  const { t: tRaw } = useTranslation();
  const t = tRaw as unknown as TFunction;
```

Replace with:

```typescript
  const { t } = useTranslation();
```

- [ ] **Step 4: Replace `setTimeout` with `useRef` + `useEffect` cleanup**

Find the `handleRun` function and its `setTimeout` call. The current shape looks like:

```typescript
  const handleRun = (e: MouseEvent): void => {
    e.stopPropagation();
    void (async () => {
      try {
        await onRun();
        setRunStatus("fired");
      } catch {
        setRunStatus("error");
      }
      setTimeout(() => setRunStatus("idle"), 2000);
    })();
  };
```

Right BEFORE `handleRun` (e.g. right after the `const summary = ...` block or right after the `useAgentsStore` line), add a `useRef` + `useEffect`:

```typescript
  const runStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (runStatusTimerRef.current !== null) {
        clearTimeout(runStatusTimerRef.current);
      }
    };
  }, []);
```

Then change the `handleRun` body to:

```typescript
  const handleRun = (e: MouseEvent): void => {
    e.stopPropagation();
    void (async () => {
      if (runStatusTimerRef.current !== null) {
        clearTimeout(runStatusTimerRef.current);
      }
      try {
        await onRun();
        setRunStatus("fired");
      } catch {
        setRunStatus("error");
      }
      runStatusTimerRef.current = setTimeout(() => setRunStatus("idle"), 2000);
    })();
  };
```

- [ ] **Step 5: Typecheck + lint + renderer tests**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
```

Expected: all green. The renderer tests don't directly exercise `RoutineRow`, but the suite should remain at the baseline count.

- [ ] **Step 6: Commit**

```powershell
git add apps/renderer/src/components/routines/RoutineRow.tsx
git commit -m "refactor(routines): clean up row cast formatrelative and timeout"
```

---

## Task 4: `setTimeout` cleanup in `RoutineForm.tsx`

**Files:**
- Modify: `apps/renderer/src/routes/RoutineForm.tsx`

Context: same pattern as Task 3 Step 4, applied to the `handleRunNow` function in the form route.

- [ ] **Step 1: Update React imports**

Open `apps/renderer/src/routes/RoutineForm.tsx`. The current React import:

```typescript
import { useEffect, useState, type FC, type FormEvent } from "react";
```

Change to:

```typescript
import { useEffect, useRef, useState, type FC, type FormEvent } from "react";
```

(`useRef` added.)

- [ ] **Step 2: Add `useRef` + `useEffect` cleanup**

Find a location near the top of the component body, near the other `useState` calls (e.g. right after `const [runStatus, setRunStatus] = useState<"idle" | "fired" | "error">("idle");`). Add:

```typescript
  const runStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (runStatusTimerRef.current !== null) {
        clearTimeout(runStatusTimerRef.current);
      }
    };
  }, []);
```

- [ ] **Step 3: Update `handleRunNow` to use the ref**

Find the `handleRunNow` function. The current shape:

```typescript
  const handleRunNow = async (): Promise<void> => {
    if (!isEdit || id === undefined) return;
    try {
      await runNowFn(id);
      setRunStatus("fired");
    } catch {
      setRunStatus("error");
    }
    setTimeout(() => setRunStatus("idle"), 2000);
  };
```

Replace with:

```typescript
  const handleRunNow = async (): Promise<void> => {
    if (!isEdit || id === undefined) return;
    if (runStatusTimerRef.current !== null) {
      clearTimeout(runStatusTimerRef.current);
    }
    try {
      await runNowFn(id);
      setRunStatus("fired");
    } catch {
      setRunStatus("error");
    }
    runStatusTimerRef.current = setTimeout(() => setRunStatus("idle"), 2000);
  };
```

- [ ] **Step 4: Typecheck + lint**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
```

Expected: green.

- [ ] **Step 5: Commit**

```powershell
git add apps/renderer/src/routes/RoutineForm.tsx
git commit -m "refactor(routines): cleanup timeout in form route"
```

---

## Task 5: `RoutineHistoryRow.tsx` component

**Files:**
- Create: `apps/renderer/src/components/routines/RoutineHistoryRow.tsx`

Context: line component. Pure presentational. Bolinha verde/cinza + timestamp + status PT + chip with reason. Uses `formatRelative` from `lib/routines/format-summary.ts` (extracted in Task 2). No tests (renderer pattern).

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/components/routines/RoutineHistoryRow.tsx` with EXACTLY:

```typescript
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityEventRow } from "@prospero/shared";
import { formatRelative } from "../../lib/routines/format-summary.js";

type Props = {
  event: ActivityEventRow;
};

const KNOWN_REASONS = new Set([
  "scheduled",
  "catchup",
  "event",
  "manual",
  "agent_unavailable",
  "budget_paused",
]);

export const RoutineHistoryRow: FC<Props> = ({ event }) => {
  const { t } = useTranslation();
  const isFired = event.action === "routine.fired";
  const rawReason =
    typeof event.payload["reason"] === "string" ? event.payload["reason"] : "";
  const reasonLabel = KNOWN_REASONS.has(rawReason)
    ? t(`routines.history.reason.${rawReason}`)
    : rawReason;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-surface-border last:border-b-0">
      <span
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          isFired ? "bg-semantic-success" : "bg-ink-soft"
        }`}
        aria-hidden="true"
      />
      <span className="text-xs text-ink-muted tabular-nums flex-shrink-0">
        {formatRelative(event.createdAt, "—")}
      </span>
      <span className="text-xs text-ink flex-1 truncate">
        {isFired
          ? t("routines.history.status.fired")
          : t("routines.history.status.skipped")}
      </span>
      {reasonLabel !== "" && (
        <span className="text-[10px] uppercase tracking-wide bg-surface-soft text-ink-muted px-1.5 py-0.5 rounded flex-shrink-0">
          {reasonLabel}
        </span>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + lint**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
```

Expected: green.

- [ ] **Step 3: Commit**

```powershell
git add apps/renderer/src/components/routines/RoutineHistoryRow.tsx
git commit -m "feat(routines): add ui history row component"
```

---

## Task 6: `RoutineHistory.tsx` component (collapsible section + IPC query)

**Files:**
- Create: `apps/renderer/src/components/routines/RoutineHistory.tsx`

Context: collapsible section. Header com chevron + título com contador (`Histórico de disparos (12)`) + botão refresh. Body: lista de `<RoutineHistoryRow>` ou empty/loading/error states. Dispara `window.prospero.activity.query` ao expandir pela primeira vez. Cache em estado interno; refresh re-busca.

`window.prospero.activity.query(params: ActivityQueryParams)` → `Promise<ActivityEventRow[]>`. Filtros: `{ entityKind: "routine", entityId: routineId }`. Limit 20.

`ActivityQueryParams` type vem de `@prospero/shared`.

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/components/routines/RoutineHistory.tsx` with EXACTLY:

```typescript
import { useState, type FC, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityEventRow } from "@prospero/shared";
import { LoadingState } from "../ui/LoadingState.js";
import { RoutineHistoryRow } from "./RoutineHistoryRow.js";

type Props = {
  routineId: string;
  companyId: string;
};

export const RoutineHistory: FC<Props> = ({ routineId, companyId }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<ActivityEventRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const rows = await window.prospero.activity.query({
        companyId,
        filters: { entityKind: "routine", entityId: routineId },
        limit: 20,
      });
      setEvents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (): void => {
    const next = !expanded;
    setExpanded(next);
    if (next && events === null) {
      void load();
    }
  };

  const handleHeaderKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  const refresh = (e: MouseEvent): void => {
    e.stopPropagation();
    void load();
  };

  const headerTitle =
    events !== null
      ? `${t("routines.history.title")} (${String(events.length)})`
      : t("routines.history.title");

  return (
    <section className="mt-6 border-t border-surface-border pt-4">
      {/* Header is a div with role=button to avoid nested-button HTML invalidity
          (the refresh control inside must remain a real <button>). */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={handleHeaderKey}
        aria-expanded={expanded}
        aria-label={expanded ? t("routines.history.collapse") : t("routines.history.expand")}
        className="w-full flex items-center gap-2 text-left text-xs font-semibold text-ink hover:text-brand cursor-pointer"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M3 2 L7 5 L3 8" />
        </svg>
        <span className="flex-1">{headerTitle}</span>
        {expanded && events !== null && (
          <button
            type="button"
            onClick={refresh}
            aria-label={t("routines.history.refresh")}
            className="text-ink-muted hover:text-ink p-1 rounded"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 4 A4 4 0 1 0 10 8" />
              <path d="M10 1 L10 4 L7 4" />
            </svg>
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3">
          {error !== null && (
            <div className="mb-2 p-2 bg-semantic-danger-bg text-semantic-danger text-xs rounded border border-semantic-danger flex items-start justify-between gap-2">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss"
                className="text-semantic-danger hover:text-ink"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M2 2 L8 8 M8 2 L2 8" />
                </svg>
              </button>
            </div>
          )}

          {loading && events === null && <LoadingState />}

          {!loading && events !== null && events.length === 0 && (
            <p className="text-xs text-ink-muted px-3 py-4 text-center">
              {t("routines.history.empty")}
            </p>
          )}

          {events !== null && events.length > 0 && (
            <div className="border border-surface-border rounded bg-surface-card">
              {events.map((e) => (
                <RoutineHistoryRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
```

Note: the outer header is a `<div role="button">` (not `<button>`) because it contains an inner `<button>` for refresh. HTML disallows nested interactive elements; the same pattern was applied to `RoutineRow` after PR-B Task 7 review.

- [ ] **Step 2: Typecheck + lint**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
```

Expected: green.

- [ ] **Step 3: Commit**

```powershell
git add apps/renderer/src/components/routines/RoutineHistory.tsx
git commit -m "feat(routines): add ui history section component"
```

---

## Task 7: Integrate `<RoutineHistory>` into `/routines/:id`

**Files:**
- Modify: `apps/renderer/src/routes/RoutineForm.tsx`

Context: render `<RoutineHistory>` below the form in edit mode (`isEdit === true && id !== undefined`). Do not render in `/routines/new`.

- [ ] **Step 1: Add the import**

Open `apps/renderer/src/routes/RoutineForm.tsx`. Right after the imports of the routines picker components, add:

```typescript
import { RoutineHistory } from "../components/routines/RoutineHistory.js";
```

- [ ] **Step 2: Render `<RoutineHistory>` below the `</form>` in edit mode**

Find the `</form>` closing tag in the JSX. RIGHT AFTER it (still inside the outer `<div className="max-w-2xl mx-auto p-6">` container), insert:

```tsx
        {isEdit && id !== undefined && activeCompanyId !== null && (
          <RoutineHistory routineId={id} companyId={activeCompanyId} />
        )}
```

- [ ] **Step 3: Typecheck + lint + renderer tests**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
```

Expected: all green. Renderer tests unchanged at the same baseline.

- [ ] **Step 4: Commit**

```powershell
git add apps/renderer/src/routes/RoutineForm.tsx
git commit -m "feat(routines): wire history panel into edit form"
```

---

## Task 8: Docs trio — `SECURITY.md` + `roadmap.html` + `ROADMAP.md`

**Files:**
- Modify: `SECURITY.md`
- Modify: `docs/roadmap.html`
- Modify: `ROADMAP.md`

Context: 3 docs updates that close the M15 milestone. SECURITY.md gains the Routines threat model section. roadmap.html turns the Routines bullet into ✅. ROADMAP.md fechado (3/3 PRs).

- [ ] **Step 1: Add the "Routines (M15)" section to `SECURITY.md`**

Open `SECURITY.md`. Find the section about the Trust Ladder (M14 PR-A) — usually labelled `### Trust Ladder (M14)` or similar. After that section ends (right before the next `###` heading or the next major section), insert:

```markdown
### Routines (M15)

A *routine* wakes a target agent on a schedule (cron-like, structured)
or on a fixed activity event. The routine itself is data — the user
authors the instruction string via the `/routines` UI; no agent
generates routines.

**Threat model:**

- *Prompt injection via routine instruction* — N/A. Instructions are
  user-authored.
- *Agent escapes via routine* — N/A. The agent woken by a routine
  passes through the gate (`request_permission`) and the trust ladder
  (M14) exactly as if the user had sent the turn manually. A `novato`
  agent will still block at the first sensitive tool call.
- *Routines firing across companies* — Blocked by FK cascade. A
  routine and its target agent share a `company_id` (PR-A migration
  `0035`); `ON DELETE CASCADE` on both companies and agents wipes
  routines automatically.
- *Routine firing on budget-paused agent* — Blocked by `fireRoutine`
  skip rule (`budget_paused`). The routine logs a `routine.skipped`
  activity event and does NOT despause.
- *Stale schedule* — Mitigated by PR-B fix: `routines:update` re-seeds
  `nextFireAt` via `computeNextFire` when `scheduleSpec` changes.
  Without this, an edit "09:00 → 14:00" would still fire at 09:00
  once before self-correcting.

**Known V2 hardening gap:** routines authored by agents (via a future
MCP tool) would re-open the prompt-injection vector. Out of scope for
v1; see `docs/superpowers/specs/2026-05-18-m15-routines-design.md` §14.
```

- [ ] **Step 2: Update the Routines bullet in `docs/roadmap.html`**

Open `docs/roadmap.html`. Search for the existing Routines mention. It may be inside a list of V2 features under labels like "Em construção", "Roadmap V2", or under the auto-derivation/learning sections. Locate the bullet and replace it with:

```html
<li><strong>Routines — funcionários acordam sozinhos.</strong> Você configura uma rotina (todo dia 9h, toda segunda, ou quando algo acontece) e ela dispara um funcionário automaticamente. Sem você precisar empurrar.</li>
```

Wrap it in a "✅" or moved-to-done container if the page has separate "Pronto" vs "Em construção" sections. Match the existing pattern in the file — if other features moved from "Em construção" to "Pronto" they'd give a template.

If the Routines bullet doesn't yet exist in the file, add it to the "Pronto" / "Done" section near other recently-shipped V2 features (M11 memory, M13 verification, M14 trust ladder & briefing).

Cap on this edit: +30 lines net. Don't add new animations or restructure the page; cosmetic copy update only.

- [ ] **Step 3: Update `ROADMAP.md` to close M15**

Open `ROADMAP.md`. There are two regions to edit:

**3a. The "▸ Agora" block (near line 142).** Find the line:

```markdown
- HEAD `main`: M15 PR-B (UI + bug-fix nextFireAt) mergeado (2026-05-20)
```

Right before that HEAD line, insert the PR-C entry. The final shape of the block should include:

```markdown
- **M15 PR-A ✅ MERGEADO** (2026-05-20) — engine backend das Routines. (...existing copy unchanged...)
- **M15 PR-B ✅ MERGEADO** (2026-05-20) — UI das Routines. (...existing copy unchanged...)
- **M15 PR-C ✅ MERGEADO** (2026-05-20) — consolidação. Painel de Histórico colapsável em `/routines/:id` lendo `activity_events` via `activity:query` (sem IPC novo). `SECURITY.md` seção Routines com threat model + gap V2. `roadmap.html` em tom leigo. Polish: dead i18n keys removidas, `setTimeout` cleanup em RoutineRow/RoutineForm, widen `TFunction` (elimina `as unknown as TFunction`), `formatRelative` extraído pra `lib/routines/`. +3 testes. **M15 3/3 PRs ✅ FECHADO.**
- **1741 testes passing + 2 todo** · 0 lint/typecheck errors
- HEAD `main`: M15 PR-C (consolidação — fecha o M15) mergeado (2026-05-20)
```

(Replace the existing test count line and HEAD line to reflect the new state.)

**3b. The "▸ Próximo" block.** Replace the existing single-row `M15 PR-C` table with:

```markdown
| Candidato | Escopo | Por quê |
|---|---|---|
| 🥇 **M16 Redesign da Interface** | Reembala a camada de apresentação pra "qualquer pessoa": barra 11→5 itens, linguagem comum, revelação progressiva. Spec em `docs/superpowers/specs/2026-05-18-m16-design.md`. | M15 fechado; o motor (M11-M15) está pronto. M16 reembala a interface antes de seguir pra V2 Tier 1 final. |
| 🥈 **Workflow Plays** | Playbooks pré-prontos que já configuram org + goals + ISAs. Mata o cold-start. Tier 1 V2. | Próxima peça V2 depois do motor (M11-M15). |
| 🥉 **Async governance** | Como uma escalada noturna se resolve sem o usuário (timeout + escalação inteligente). Tier 2. | Outra metade do loop assíncrono que o M14 começou. |
```

Followed by:

```markdown
**Recomendação:** decisão do próximo passo fica para o usuário em sessão futura. O motor V2 (M11-M15) está completo.
```

**3c. The "Status atual" table.** Update the "Concluído recentemente" cell. Replace the existing PR-B summary block with:

```markdown
| Concluído recentemente | **M15 PR-C — consolidação (fecha o M15 inteiro)** mergeado 2026-05-20. ~8 tasks · ~10 commits em `main`. Entrega: (1) painel "Histórico de disparos" colapsável em `/routines/:id` — header com contador, botão refresh SVG, lista de linhas com bolinha verde/cinza + status PT + chip de reason. Reusa `activity:query` do M7.7 sem IPC novo. (2) `SECURITY.md` seção Routines com threat model (prompt injection N/A, agent escape gated pelo trust ladder, FK cascade entre companies/agents, skip de budget-paused, stale schedule mitigado pelo PR-B fix) + gap V2 conhecido (routines autoradas por agente). (3) `docs/roadmap.html` em tom leigo: Routines de ✅. (4) `ROADMAP.md` fechado (3/3). (5) Polish UI: `routines.empty.cta`/`empty.title` dead keys removidas; `setTimeout` cleanup via `useRef` em RoutineRow e RoutineForm; `TFunction` widened via type-only import de `i18next` (elimina o `as unknown as TFunction` cast em RoutineRow); `formatRelative` movido de RoutineRow pra `lib/routines/format-summary.ts` (compartilhado com RoutineHistoryRow). +3 testes (`formatRelative`). **M15 3/3 PRs ✅ FECHADO.** Antes: **M15 PR-B** (UI + bug-fix `nextFireAt`) mergeado 2026-05-20. |
| Testes | **1741 passing + 2 todo**, 0 lint/typecheck errors |
```

**3d. The "Restante pra v1" cell.** Update to:

```markdown
| Restante pra v1 | **Nada — v1 fechado em 2026-05-15.** M11 + M12 + M13 + M14 + **M15 fechado (3/3 PRs)**. Próximo: M16 (UI redesign) ou Workflow Plays (V2 Tier 1) ou Async governance (V2 Tier 2). |
```

- [ ] **Step 4: Run full test + typecheck + lint**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm test
```

Expected: ALL green across 4 packages.

- [ ] **Step 5: Pre-commit sanity**

```powershell
git status --short
git diff HEAD --stat
```

Confirm only the 3 expected files: `SECURITY.md`, `docs/roadmap.html`, `ROADMAP.md`.

- [ ] **Step 6: Commit**

```powershell
git add SECURITY.md docs/roadmap.html ROADMAP.md
git commit -m "docs(routines): close m15 with security and roadmap updates"
```

---

## Final verification

- [ ] **Step 1: Run the full suite**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm test
```

Expected:
- typecheck: 4 packages green.
- lint: 4 packages green.
- tests: ~1741 passing total across 4 packages (main 1393 unchanged · shared 100 unchanged · renderer 198 (was 195, +3 from `formatRelative` tests) · agent-runner 50 unchanged).

- [ ] **Step 2: Inspect commit graph**

```powershell
git log --oneline afeaa4d..HEAD
```

Expected: ~10 commits (8 task commits + possible review-fix commits + 1 ROADMAP commit if not bundled with Task 8 step 3).

- [ ] **Step 3: Smoke test (manual, if Electron available)**

If `pnpm dev` is available on the machine:

1. Start the app.
2. Click "Routines" in the sidebar.
3. Open an existing routine (or create one + run it once).
4. Scroll down past the form — confirm "Histórico de disparos" section visible with chevron + contador.
5. Click the chevron — section expands, loading spinner briefly, then either rows or "Esta routine nunca disparou".
6. If rows are present: each row shows bolinha + timestamp + status + reason chip.
7. Click refresh icon — section re-fetches.
8. Click chevron again — section collapses.
9. Click "Rodar agora" — wait 2s, then navigate to another page within the 2s window. Confirm no React warning in console.
10. Open the DevTools React profiler / check that mounting/unmounting RoutineForm doesn't leak timers (advanced — skip if not familiar).

If `pnpm dev` cannot run (Electron-only context), skip this step. Tests + typecheck + lint provide the regression net.

- [ ] **Step 4: Push to origin/main**

```powershell
git push origin main
```

- [ ] **Step 5: Memory update**

Create `project_m15_pr_c_lessons.md` capturing:
- HEAD SHA after merge.
- Commit count + test delta.
- Decisões travadas: history como seção colapsável; linha rica com bolinha + chip.
- Polish absorvido: dead i18n keys, setTimeout cleanup via useRef, TFunction widened via i18next type-only import, formatRelative extracted.
- Surprises encountered (e.g., did `t` from useTranslation typecheck against the widened TFunction without further casts).

Update `MEMORY.md` index with one-line entry. Update `project_session_handoff.md` to mark M15 fully closed (3/3) and list next candidates (M16 / Workflow Plays / Async governance).

---

## Notes for the implementer

- The `Section` primitive (`apps/renderer/src/components/ui/Section.tsx`) is title-only, NOT collapsible. Build the collapsible behavior inline in `RoutineHistory.tsx` (Task 6). Do not modify `Section.tsx`.
- The `LoadingState` primitive (`apps/renderer/src/components/ui/LoadingState.tsx`) accepts `{ label?: string }`. Use it for the loading state inside `RoutineHistory`.
- No emojis in the UI (user rule [[feedback-no-emojis]]). Chevron, refresh, and dismiss icons are inline SVG paths in Task 6. The play SVG in RoutineRow (PR-B) is unchanged.
- The `as unknown as TFunction` cast in RoutineRow (PR-B Task 7) goes away in Task 3 because Task 2 widens `TFunction` to be the real i18next one. If `pnpm typecheck` fails on Task 3 because react-i18next overload signatures don't match, fall back to keeping the cast and skip Task 3's Step 3 — but typecheck FIRST. The expected outcome is that the cast becomes redundant.
- The `formatRelative` extraction (Task 2) is the dependency for both RoutineRow (Task 3) and RoutineHistoryRow (Task 5). Tasks 3 and 5 should NOT redefine the function.
- `window.prospero.activity.query` already exists (M7.7, see `apps/main/src/ipc/preload.ts:376-378`). Do not add new IPC.
- Renderer-only PR: zero changes to `apps/main/`. If you find yourself editing main code, stop and re-read the spec.
- ROADMAP.md is the user's primary roadmap doc; copy in Task 8 Step 3c should be faithful to the live state at commit time. If something changed during PR-C execution (e.g. extra fix commits), reflect it in the "Concluído recentemente" cell before committing.
