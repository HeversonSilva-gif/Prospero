# M15 PR-B — Routines UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a interface humana das Routines — lista em `/routines`, form de criar/editar em rota dedicada `/routines/new` + `/routines/:id`, picker de recorrência em 4 tabs, toggle inline na lista, "Rodar agora", excluir. Renderer-only mais um bug-fix de 3 arquivos no main (re-seed `nextFireAt` quando `scheduleSpec` muda).

**Architecture:** 3 rotas novas usando React Router (HashRouter já existente). Estado via zustand store `useRoutinesStore` espelhando o padrão de `briefing.ts`/`agents.ts`. Formatters puros em `lib/routines/`. Componentes em `components/routines/`. i18n via JSON (`en-US.json` + `pt-BR.json`). Sidebar entry inline no `App.tsx`.

**Tech Stack:** React 18 · React Router v6 (HashRouter) · zustand · react-i18next · Tailwind · TypeScript strict · vitest + Testing Library (apenas onde a base tem precedente — `lib/` puro e `stores/` com IPC mockado). Window bridge: `window.prospero.routines.{list,create,update,delete,runNow}` (exposto no PR-A).

**Spec:** `docs/superpowers/specs/2026-05-20-m15-pr-b-routines-ui-design.md` (commit `4c19013`). Base de execução: HEAD `07aeff7` (M15 PR-A close).

---

## File map

**Criados (renderer, 11):**
- `apps/renderer/src/stores/routines.ts` — zustand store
- `apps/renderer/src/stores/routines.test.ts` — store tests
- `apps/renderer/src/lib/routines/format-summary.ts` — `formatScheduleSummary` + `formatEventSummary` + helpers (`parseAtMinute`, `formatAtMinute`)
- `apps/renderer/src/lib/routines/format-summary.test.ts` — formatters tests
- `apps/renderer/src/components/routines/RecurrencePicker.tsx`
- `apps/renderer/src/components/routines/EventPicker.tsx`
- `apps/renderer/src/components/routines/TargetAgentPicker.tsx`
- `apps/renderer/src/components/routines/RoutineRow.tsx`
- `apps/renderer/src/routes/Routines.tsx` — lista
- `apps/renderer/src/routes/RoutineForm.tsx` — single route component que cobre `/routines/new` e `/routines/:id`

**Modificados (renderer, 3):**
- `apps/renderer/src/App.tsx` — registra 3 rotas + adiciona NavLink "Routines" no Sidebar inline
- `apps/renderer/src/i18n/en-US.json` — chaves `routines.*` + `nav.routines`
- `apps/renderer/src/i18n/pt-BR.json` — idem

**Modificados (main, 3 — bug-fix do PR-A):**
- `apps/main/src/schemas/routine.ts` — `ROUTINE_UPDATE_INPUT_SCHEMA` ganha `nextFireAt: z.number().int().nullable().optional()`
- `apps/main/src/ipc/routines-handlers.ts` — `update()` re-semeia `nextFireAt` quando `scheduleSpec` muda
- `apps/main/tests/routines-handlers.test.ts` — +1 teste

**Total:** 11 criados + 6 modificados = 17 arquivos. Ordem: bug-fix do main primeiro (independente), i18n segundo (base pra todo o resto), depois formatters → store → componentes → rotas → wiring no App.tsx.

---

## Conventions

- Sempre rodar `pnpm typecheck` antes de commitar uma task — vitest com esbuild **não pega** type holes (lesson [[project-m14-pr-a-lessons]]).
- Antes do commit final de cada task: `git status --short` + `git diff HEAD --stat` para confirmar disk == staged == HEAD.
- Pre-commit hook reformata (prettier) + eslint-fix + gitleaks. Warning CRLF no Windows — inofensivo.
- Commits lowercase, sem `+`/`%`, ≤72 chars (commitlint).
- Nunca `--no-verify`.
- IPC bridge é `window.prospero.routines.*` (não `window.api` — confirmado em `apps/main/src/ipc/preload.ts:485`).
- Stores: zustand com `create<State>((set, get) => ({...}))`. State + ações no mesmo objeto. Padrão recente: `apps/renderer/src/stores/briefing.ts`.
- Routes: arquivo `.tsx` direto em `apps/renderer/src/routes/`. Padrão: `Briefing.tsx`, `Roles.tsx`, `GoalNew.tsx`.
- Components: subpasta por feature em `apps/renderer/src/components/<feature>/`. Padrão: `inbox/`, `dashboard/`, `costs/`. Vou criar `components/routines/`.
- Empty state: usar primitivo `<EmptyState message={...} icon={...} />` de `apps/renderer/src/components/ui/EmptyState.tsx` (props: `message` string + `icon` ReactNode opcional — NÃO aceita CTA inline; CTA fica no header da página).
- TabBar: primitivo `<TabBar tabs={[]} active={} onSelect={} variant="segmented" />` de `apps/renderer/src/components/ui/TabBar.tsx`. Vou usar pra `RecurrencePicker`.
- i18n: JSON aninhado (não flat). Acesso: `t("routines.form.name")`. Variáveis: `t("routines.row.lastFired", { when: "..." })`.
- Active company: `const activeCompanyId = useCompaniesStore((s) => s.activeId);` (padrão `Briefing.tsx:76`). Returns `null` se nenhuma — renderer trata.

### Comandos

Pasta raiz: `D:\Projetos pessoais\DashboardAgent`. PowerShell.

- Tests main único arquivo: `cd "D:\Projetos pessoais\DashboardAgent\apps\main"; npx vitest run <relative-path>`
- Tests renderer único arquivo: `cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"; npx vitest run <relative-path>`
- Tests full main: `pnpm --filter @prospero/main test`
- Tests full renderer: `pnpm --filter @prospero/renderer test`
- Typecheck workspace: `pnpm typecheck`
- Lint: `pnpm lint`

---

## Task 1: Main bug-fix — re-seed `nextFireAt` em `routines:update`

**Files:**
- Modify: `apps/main/src/schemas/routine.ts:62-68` (UPDATE schema)
- Modify: `apps/main/src/ipc/routines-handlers.ts:60` (update handler)
- Modify: `apps/main/tests/routines-handlers.test.ts` (+1 teste)

Context: Final reviewer holístico do PR-A identificou que `update` não re-semeia `nextFireAt` quando `scheduleSpec` muda. Resultado: usuário edita o horário "09:00" → "14:00" e o próximo fire ainda dispara em 09:00 (depois o scheduler self-corrige). Esse PR fecha o ciclo.

- [ ] **Step 1: Write the failing test**

Open `apps/main/tests/routines-handlers.test.ts` and add this test inside the `describe("routinesHandlers", ...)` block (right after the existing `runNow` test, before the closing `});`):

```typescript
  it("update — re-seeds nextFireAt when scheduleSpec changes", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "Standup",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "x",
      },
    });
    const initialNextFire = created.nextFireAt;
    expect(initialNextFire).not.toBeNull();

    const updated = h.update({
      input: {
        id: created.id,
        scheduleSpec: { freq: "daily", atMinute: 600 },
      },
    });

    expect(updated.nextFireAt).not.toBeNull();
    expect(updated.nextFireAt).not.toBe(initialNextFire);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "D:\Projetos pessoais\DashboardAgent\apps\main"; npx vitest run tests/routines-handlers.test.ts`
Expected: 5 pass + 1 FAIL on the new test (assertion `updated.nextFireAt).not.toBe(initialNextFire)` fails because update keeps the stale value).

- [ ] **Step 3: Add `nextFireAt` to the UPDATE schema**

Open `apps/main/src/schemas/routine.ts`. Find the `ROUTINE_UPDATE_INPUT_SCHEMA` block. Add `nextFireAt: z.number().int().nullable().optional(),` as a new field. The schema currently looks like:

```typescript
export const ROUTINE_UPDATE_INPUT_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  scheduleSpec: ScheduleSpecSchema.optional(),
  eventSpec: EventSpecSchema.optional(),
  targetAgentId: z.string().min(1).optional(),
  instruction: z.string().min(1).max(4000).optional(),
});
```

Change it to:

```typescript
export const ROUTINE_UPDATE_INPUT_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  scheduleSpec: ScheduleSpecSchema.optional(),
  eventSpec: EventSpecSchema.optional(),
  nextFireAt: z.number().int().nullable().optional(),
  targetAgentId: z.string().min(1).optional(),
  instruction: z.string().min(1).max(4000).optional(),
});
```

- [ ] **Step 4: Implement re-seed in the handler**

Open `apps/main/src/ipc/routines-handlers.ts`. Find the `update({ input })` method body. The current shape (post Task 11 of PR-A) uses a spread-only-defined pattern. Replace the `update` method body with:

```typescript
    update({ input }) {
      const parsed = ROUTINE_UPDATE_INPUT_SCHEMA.parse(input);

      // M15 PR-B: re-seed nextFireAt when scheduleSpec changes on a schedule
      // routine. Mirror of seedNextFire used in `create`. Skipped if the caller
      // already provided nextFireAt explicitly (e.g. internal advance after fire).
      let computedNextFireAt: number | undefined;
      if (parsed.scheduleSpec !== undefined && parsed.nextFireAt === undefined) {
        const existing = repo.getById(parsed.id);
        if (existing !== null && existing.triggerType === "schedule") {
          computedNextFireAt = computeNextFire(
            parsed.scheduleSpec,
            new Date(Date.now()),
          ).getTime();
        }
      }

      return repo.update({
        ...parsed,
        ...(computedNextFireAt !== undefined && { nextFireAt: computedNextFireAt }),
      });
    },
```

- [ ] **Step 5: Run the test again**

Run: `cd "D:\Projetos pessoais\DashboardAgent\apps\main"; npx vitest run tests/routines-handlers.test.ts`
Expected: 6/6 pass.

- [ ] **Step 6: Typecheck + full main suite**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm --filter @prospero/main test
```

Expected: both green.

- [ ] **Step 7: Commit**

```powershell
git add apps/main/src/schemas/routine.ts apps/main/src/ipc/routines-handlers.ts apps/main/tests/routines-handlers.test.ts
git commit -m "fix(routines): re-seed nextFireAt when scheduleSpec changes"
```

---

## Task 2: i18n keys (pt-BR + en-US)

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

Context: ~46 chaves novas em `routines.*` + 1 `nav.routines`. JSON aninhado (não flat). Padrão: `apps/renderer/src/i18n/en-US.json` e `pt-BR.json`. Há um teste de paridade em `apps/renderer/src/i18n/parity.test.ts` que valida que toda chave em en também existe em pt — adicionar mesma estrutura nos dois.

- [ ] **Step 1: Add `routines` block to `en-US.json`**

Open `apps/renderer/src/i18n/en-US.json`. Find the closing `}` of the JSON. Right before the last `}`, add a comma after the last existing top-level key, then add the `routines` block.

Add this section (preserve valid JSON — last key in the file gets a trailing comma, then add the new block):

```json
  "routines": {
    "title": "Routines",
    "subtitle": "Agents that wake on their own",
    "new": "New routine",
    "empty": {
      "title": "No routines yet",
      "description": "Create the first one so an agent wakes on its own — on a schedule or in response to an event.",
      "cta": "Create first routine"
    },
    "form": {
      "name": "Name",
      "trigger": "Trigger",
      "triggerSchedule": "Schedule",
      "triggerEvent": "Event",
      "recurrence": "Recurrence",
      "freq": {
        "daily": "Daily",
        "weekly": "Weekly",
        "monthly": "Monthly",
        "interval": "Interval"
      },
      "atMinute": "Time of day",
      "weekday": "Weekday",
      "monthDay": "Day of month",
      "everyMinutes": "Every (minutes)",
      "event": "Event type",
      "events": {
        "goal_achieved": "Goal achieved",
        "verification_failed": "Verification failed",
        "issue_done": "Issue done",
        "agent_recovered": "Agent recovered"
      },
      "targetAgent": "Target agent",
      "targetAgentPlaceholder": "— Select an agent —",
      "targetAgentEmpty": "No agents available. Hire one first.",
      "instruction": "Instruction",
      "create": "Create",
      "save": "Save",
      "saving": "Saving…",
      "cancel": "Cancel",
      "runNow": "Run now",
      "runNowFired": "Fired",
      "runNowError": "Error",
      "delete": "Delete",
      "deleteConfirm": "Delete routine '{{name}}'?",
      "notFound": "Routine not found",
      "back": "Back",
      "header": {
        "new": "New routine",
        "edit": "Edit routine"
      }
    },
    "row": {
      "lastFired": "Last: {{when}}",
      "nextFire": "Next: {{when}}",
      "paused": "paused",
      "neverFired": "never"
    },
    "summary": {
      "daily": "Every day at {{time}}",
      "weekly": "Every {{weekday}} at {{time}}",
      "monthly": "Every {{day}}th at {{time}}",
      "interval": "Every {{minutes}} min",
      "event": "When: {{event}}"
    },
    "weekday": {
      "0": "Sunday",
      "1": "Monday",
      "2": "Tuesday",
      "3": "Wednesday",
      "4": "Thursday",
      "5": "Friday",
      "6": "Saturday"
    }
  }
```

Also find the `"nav": { ... }` block at the top and add inside it:

```json
    "routines": "Routines",
```

(Place it between `"briefing"` and `"dashboard"` — alphabetical-ish, but the important thing is it lives inside the `nav` object.)

- [ ] **Step 2: Add `routines` block to `pt-BR.json`**

Open `apps/renderer/src/i18n/pt-BR.json`. Mirror the structure with Brazilian Portuguese translations:

```json
  "routines": {
    "title": "Routines",
    "subtitle": "Agentes que acordam sozinhos",
    "new": "Nova routine",
    "empty": {
      "title": "Nenhuma routine ainda",
      "description": "Crie a primeira para que um agente acorde sozinho em horário ou por evento.",
      "cta": "Criar primeira routine"
    },
    "form": {
      "name": "Nome",
      "trigger": "Gatilho",
      "triggerSchedule": "Schedule",
      "triggerEvent": "Evento",
      "recurrence": "Recorrência",
      "freq": {
        "daily": "Diário",
        "weekly": "Semanal",
        "monthly": "Mensal",
        "interval": "Intervalo"
      },
      "atMinute": "Horário",
      "weekday": "Dia da semana",
      "monthDay": "Dia do mês",
      "everyMinutes": "A cada (minutos)",
      "event": "Tipo de evento",
      "events": {
        "goal_achieved": "Objetivo alcançado",
        "verification_failed": "Verificação falhou",
        "issue_done": "Issue concluída",
        "agent_recovered": "Agente recuperou"
      },
      "targetAgent": "Agente alvo",
      "targetAgentPlaceholder": "— Selecione um agente —",
      "targetAgentEmpty": "Nenhum agente disponível. Contrate um primeiro.",
      "instruction": "Instrução",
      "create": "Criar",
      "save": "Salvar",
      "saving": "Salvando…",
      "cancel": "Cancelar",
      "runNow": "Rodar agora",
      "runNowFired": "Disparada",
      "runNowError": "Erro",
      "delete": "Excluir",
      "deleteConfirm": "Excluir routine '{{name}}'?",
      "notFound": "Routine não encontrada",
      "back": "Voltar",
      "header": {
        "new": "Nova routine",
        "edit": "Editar routine"
      }
    },
    "row": {
      "lastFired": "Último: {{when}}",
      "nextFire": "Próximo: {{when}}",
      "paused": "pausada",
      "neverFired": "nunca"
    },
    "summary": {
      "daily": "Toda dia {{time}}",
      "weekly": "Toda {{weekday}} {{time}}",
      "monthly": "Todo dia {{day}} às {{time}}",
      "interval": "A cada {{minutes}} min",
      "event": "Quando: {{event}}"
    },
    "weekday": {
      "0": "domingo",
      "1": "segunda",
      "2": "terça",
      "3": "quarta",
      "4": "quinta",
      "5": "sexta",
      "6": "sábado"
    }
  }
```

And inside the `"nav": {}` block:

```json
    "routines": "Routines",
```

- [ ] **Step 3: Run the i18n parity test**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/i18n/parity.test.ts
```

Expected: pass (all keys mirrored between en/pt).

- [ ] **Step 4: Typecheck**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```powershell
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(routines): add ui i18n keys"
```

---

## Task 3: `format-summary.ts` — pure formatters

**Files:**
- Create: `apps/renderer/src/lib/routines/format-summary.ts`
- Create: `apps/renderer/src/lib/routines/format-summary.test.ts`

Context: Functions that turn `ScheduleSpec` / `EventSpec` into i18n-aware human-readable strings, used by `RoutineRow` and elsewhere. Plus `parseAtMinute("HH:MM") → number` and `formatAtMinute(540) → "09:00"` helpers used by `RecurrencePicker`.

- [ ] **Step 1: Write the failing tests**

Create `apps/renderer/src/lib/routines/format-summary.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  formatScheduleSummary,
  formatEventSummary,
  parseAtMinute,
  formatAtMinute,
} from "./format-summary.js";

// Fake t() returns the key + params for inspection.
const t = (key: string, params?: Record<string, string | number>): string => {
  if (params === undefined) return key;
  const pairs = Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(",");
  return `${key}{${pairs}}`;
};

describe("formatScheduleSummary", () => {
  it("daily → routines.summary.daily with time", () => {
    expect(formatScheduleSummary({ freq: "daily", atMinute: 540 }, t)).toBe(
      "routines.summary.daily{time=09:00}",
    );
  });

  it("weekly → routines.summary.weekly with weekday name and time", () => {
    expect(formatScheduleSummary({ freq: "weekly", weekday: 1, atMinute: 540 }, t)).toBe(
      "routines.summary.weekly{weekday=routines.weekday.1,time=09:00}",
    );
  });

  it("monthly → routines.summary.monthly with day and time", () => {
    expect(formatScheduleSummary({ freq: "monthly", day: 15, atMinute: 540 }, t)).toBe(
      "routines.summary.monthly{day=15,time=09:00}",
    );
  });

  it("interval → routines.summary.interval with minutes", () => {
    expect(formatScheduleSummary({ freq: "interval", everyMinutes: 30 }, t)).toBe(
      "routines.summary.interval{minutes=30}",
    );
  });
});

describe("formatEventSummary", () => {
  it("goal_achieved → routines.summary.event with event label", () => {
    expect(formatEventSummary({ eventType: "goal_achieved" }, t)).toBe(
      "routines.summary.event{event=routines.form.events.goal_achieved}",
    );
  });

  it("verification_failed → label key", () => {
    expect(formatEventSummary({ eventType: "verification_failed" }, t)).toBe(
      "routines.summary.event{event=routines.form.events.verification_failed}",
    );
  });

  it("issue_done → label key", () => {
    expect(formatEventSummary({ eventType: "issue_done" }, t)).toBe(
      "routines.summary.event{event=routines.form.events.issue_done}",
    );
  });

  it("agent_recovered → label key", () => {
    expect(formatEventSummary({ eventType: "agent_recovered" }, t)).toBe(
      "routines.summary.event{event=routines.form.events.agent_recovered}",
    );
  });
});

describe("parseAtMinute", () => {
  it("'09:00' → 540", () => {
    expect(parseAtMinute("09:00")).toBe(540);
  });
  it("'23:59' → 1439", () => {
    expect(parseAtMinute("23:59")).toBe(1439);
  });
  it("'00:00' → 0", () => {
    expect(parseAtMinute("00:00")).toBe(0);
  });
  it("malformed → 0", () => {
    expect(parseAtMinute("")).toBe(0);
    expect(parseAtMinute("nope")).toBe(0);
  });
});

describe("formatAtMinute", () => {
  it("540 → '09:00'", () => {
    expect(formatAtMinute(540)).toBe("09:00");
  });
  it("0 → '00:00'", () => {
    expect(formatAtMinute(0)).toBe("00:00");
  });
  it("1439 → '23:59'", () => {
    expect(formatAtMinute(1439)).toBe("23:59");
  });
  it("zero-pads hour and minute", () => {
    expect(formatAtMinute(65)).toBe("01:05");
  });
});
```

- [ ] **Step 2: Run, see fail**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/lib/routines/format-summary.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `apps/renderer/src/lib/routines/format-summary.ts`:

```typescript
import type { EventSpec, RoutineEventType, ScheduleSpec } from "@prospero/shared";

// M15 PR-B — pure formatters used by RoutineRow and elsewhere.
// `t` is the i18next-style translator: callers inject it so the module stays
// renderer-pure (no react-i18next coupling).

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

export const formatAtMinute = (atMinute: number): string => {
  const h = Math.floor(atMinute / 60);
  const m = atMinute % 60;
  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  return `${hh}:${mm}`;
};

export const parseAtMinute = (value: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match === null) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
};

export const formatScheduleSummary = (spec: ScheduleSpec, t: TFunction): string => {
  if (spec.freq === "interval") {
    return t("routines.summary.interval", { minutes: spec.everyMinutes });
  }
  if (spec.freq === "daily") {
    return t("routines.summary.daily", { time: formatAtMinute(spec.atMinute) });
  }
  if (spec.freq === "weekly") {
    return t("routines.summary.weekly", {
      weekday: t(`routines.weekday.${String(spec.weekday)}`),
      time: formatAtMinute(spec.atMinute),
    });
  }
  if (spec.freq === "monthly") {
    return t("routines.summary.monthly", {
      day: spec.day,
      time: formatAtMinute(spec.atMinute),
    });
  }
  const _exhaustive: never = spec;
  return _exhaustive;
};

export const formatEventSummary = (spec: EventSpec, t: TFunction): string => {
  return t("routines.summary.event", {
    event: t(eventLabelKey(spec.eventType)),
  });
};

const eventLabelKey = (eventType: RoutineEventType): string => {
  return `routines.form.events.${eventType}`;
};
```

- [ ] **Step 4: Run, confirm pass**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/lib/routines/format-summary.test.ts
```

Expected: 17/17 pass.

- [ ] **Step 5: Typecheck + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
git add apps/renderer/src/lib/routines/format-summary.ts apps/renderer/src/lib/routines/format-summary.test.ts
git commit -m "feat(routines): add ui summary formatters"
```

---

## Task 4: `routines` zustand store + tests

**Files:**
- Create: `apps/renderer/src/stores/routines.ts`
- Create: `apps/renderer/src/stores/routines.test.ts`

Context: Espelha `apps/renderer/src/stores/briefing.ts` (recente, M14 PR-C). Optimistic toggle; load idempotent; getById é leitura de memória. IPC calls via `window.prospero.routines.*`.

- [ ] **Step 1: Write the failing tests**

Create `apps/renderer/src/stores/routines.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Routine } from "@prospero/shared";
import { useRoutinesStore } from "./routines.js";

const makeRoutine = (overrides: Partial<Routine> = {}): Routine => ({
  id: "routine_1",
  companyId: "c1",
  name: "Standup",
  enabled: true,
  triggerType: "schedule",
  scheduleSpec: { freq: "daily", atMinute: 540 },
  nextFireAt: 1000,
  eventSpec: null,
  targetAgentId: "a1",
  instruction: "x",
  lastFiredAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const stubApi = (overrides: Partial<{
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  runNow: ReturnType<typeof vi.fn>;
}> = {}): void => {
  (globalThis as unknown as { window: { prospero: { routines: unknown } } }).window = {
    prospero: {
      routines: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue({ ok: true }),
        runNow: vi.fn().mockResolvedValue({ ok: true }),
        ...overrides,
      },
    },
  };
};

beforeEach(() => {
  // reset store between tests
  useRoutinesStore.setState({ routines: null, loading: false, error: null });
});

describe("useRoutinesStore", () => {
  it("load — fetches and sets routines", async () => {
    const r = makeRoutine();
    stubApi({ list: vi.fn().mockResolvedValue([r]) });
    await useRoutinesStore.getState().load("c1");
    expect(useRoutinesStore.getState().routines).toEqual([r]);
    expect(useRoutinesStore.getState().loading).toBe(false);
  });

  it("load — sets error on failure", async () => {
    stubApi({ list: vi.fn().mockRejectedValue(new Error("boom")) });
    await useRoutinesStore.getState().load("c1");
    expect(useRoutinesStore.getState().routines).toBeNull();
    expect(useRoutinesStore.getState().error).toBe("boom");
  });

  it("getById — returns routine by id from loaded list", async () => {
    const r1 = makeRoutine({ id: "routine_1" });
    const r2 = makeRoutine({ id: "routine_2" });
    stubApi({ list: vi.fn().mockResolvedValue([r1, r2]) });
    await useRoutinesStore.getState().load("c1");
    expect(useRoutinesStore.getState().getById("routine_2")).toEqual(r2);
    expect(useRoutinesStore.getState().getById("nope")).toBeNull();
  });

  it("create — appends to list", async () => {
    const created = makeRoutine({ id: "routine_new" });
    stubApi({ list: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(created) });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().create({ name: "X" });
    expect(useRoutinesStore.getState().routines).toEqual([created]);
  });

  it("update — replaces routine in list", async () => {
    const r = makeRoutine({ id: "routine_1", name: "Old" });
    const updated = makeRoutine({ id: "routine_1", name: "New" });
    stubApi({
      list: vi.fn().mockResolvedValue([r]),
      update: vi.fn().mockResolvedValue(updated),
    });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().update({ id: "routine_1", name: "New" });
    expect(useRoutinesStore.getState().routines?.[0]?.name).toBe("New");
  });

  it("delete — removes routine from list", async () => {
    const r = makeRoutine({ id: "routine_1" });
    stubApi({ list: vi.fn().mockResolvedValue([r]) });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().delete("routine_1");
    expect(useRoutinesStore.getState().routines).toEqual([]);
  });

  it("toggleEnabled — flips optimistically and calls update", async () => {
    const r = makeRoutine({ id: "routine_1", enabled: true });
    const updateFn = vi.fn().mockResolvedValue(makeRoutine({ id: "routine_1", enabled: false }));
    stubApi({ list: vi.fn().mockResolvedValue([r]), update: updateFn });
    await useRoutinesStore.getState().load("c1");
    const promise = useRoutinesStore.getState().toggleEnabled("routine_1");
    // optimistic: enabled flipped synchronously
    expect(useRoutinesStore.getState().routines?.[0]?.enabled).toBe(false);
    await promise;
    expect(updateFn).toHaveBeenCalledWith({ input: { id: "routine_1", enabled: false } });
  });

  it("toggleEnabled — reverts on IPC failure", async () => {
    const r = makeRoutine({ id: "routine_1", enabled: true });
    const updateFn = vi.fn().mockRejectedValue(new Error("denied"));
    stubApi({ list: vi.fn().mockResolvedValue([r]), update: updateFn });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().toggleEnabled("routine_1");
    expect(useRoutinesStore.getState().routines?.[0]?.enabled).toBe(true);
    expect(useRoutinesStore.getState().error).toBe("denied");
  });

  it("runNow — calls IPC, does not mutate routines list", async () => {
    const r = makeRoutine();
    const runNowFn = vi.fn().mockResolvedValue({ ok: true });
    stubApi({ list: vi.fn().mockResolvedValue([r]), runNow: runNowFn });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().runNow("routine_1");
    expect(runNowFn).toHaveBeenCalledWith({ id: "routine_1" });
  });
});
```

- [ ] **Step 2: Run, see fail**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/stores/routines.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `apps/renderer/src/stores/routines.ts`:

```typescript
import { create } from "zustand";
import type { Routine } from "@prospero/shared";

interface RoutinesState {
  routines: Routine[] | null;
  loading: boolean;
  error: string | null;
  load: (companyId: string) => Promise<void>;
  getById: (id: string) => Routine | null;
  create: (input: unknown) => Promise<Routine>;
  update: (input: unknown) => Promise<Routine>;
  delete: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  toggleEnabled: (id: string) => Promise<void>;
}

const errString = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const useRoutinesStore = create<RoutinesState>((set, get) => ({
  routines: null,
  loading: false,
  error: null,

  async load(companyId) {
    set({ loading: true, error: null });
    try {
      const list = await window.prospero.routines.list({ companyId });
      set({ routines: list, loading: false });
    } catch (err) {
      set({ loading: false, error: errString(err) });
    }
  },

  getById(id) {
    const list = get().routines;
    if (list === null) return null;
    return list.find((r) => r.id === id) ?? null;
  },

  async create(input) {
    try {
      const created = await window.prospero.routines.create({ input });
      set((s) => ({ routines: s.routines === null ? [created] : [...s.routines, created] }));
      return created;
    } catch (err) {
      set({ error: errString(err) });
      throw err;
    }
  },

  async update(input) {
    try {
      const updated = await window.prospero.routines.update({ input });
      set((s) => ({
        routines:
          s.routines === null
            ? [updated]
            : s.routines.map((r) => (r.id === updated.id ? updated : r)),
      }));
      return updated;
    } catch (err) {
      set({ error: errString(err) });
      throw err;
    }
  },

  async delete(id) {
    try {
      await window.prospero.routines.delete({ id });
      set((s) => ({
        routines: s.routines === null ? null : s.routines.filter((r) => r.id !== id),
      }));
    } catch (err) {
      set({ error: errString(err) });
      throw err;
    }
  },

  async runNow(id) {
    try {
      await window.prospero.routines.runNow({ id });
    } catch (err) {
      set({ error: errString(err) });
      throw err;
    }
  },

  async toggleEnabled(id) {
    const before = get().routines;
    if (before === null) return;
    const target = before.find((r) => r.id === id);
    if (target === undefined) return;
    const next = !target.enabled;

    // Optimistic flip.
    set({
      routines: before.map((r) => (r.id === id ? { ...r, enabled: next } : r)),
    });

    try {
      await window.prospero.routines.update({ input: { id, enabled: next } });
    } catch (err) {
      // Revert.
      set({ routines: before, error: errString(err) });
    }
  },
}));
```

- [ ] **Step 4: Run, confirm pass**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/stores/routines.test.ts
```

Expected: 9/9 pass.

- [ ] **Step 5: Typecheck + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
git add apps/renderer/src/stores/routines.ts apps/renderer/src/stores/routines.test.ts
git commit -m "feat(routines): add ui zustand store"
```

---

## Task 5: `RecurrencePicker` component

**Files:**
- Create: `apps/renderer/src/components/routines/RecurrencePicker.tsx`

Context: 4 tabs (daily/weekly/monthly/interval) via primitivo `<TabBar variant="segmented">`. Internal state `freq`. Mudar de tab emite `onChange` com defaults da nova freq. Inputs HTML5 nativos (`type="time"`, `type="number"`). No tests (renderer pattern — visual cobertura no smoke manual).

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/components/routines/RecurrencePicker.tsx`:

```typescript
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduleSpec } from "@prospero/shared";
import { TabBar } from "../ui/TabBar.js";
import { formatAtMinute, parseAtMinute } from "../../lib/routines/format-summary.js";

type Freq = "daily" | "weekly" | "monthly" | "interval";

type Props = {
  value: ScheduleSpec;
  onChange: (s: ScheduleSpec) => void;
};

const defaultForFreq = (freq: Freq): ScheduleSpec => {
  if (freq === "daily") return { freq: "daily", atMinute: 540 };
  if (freq === "weekly") return { freq: "weekly", weekday: 1, atMinute: 540 };
  if (freq === "monthly") return { freq: "monthly", day: 1, atMinute: 540 };
  return { freq: "interval", everyMinutes: 30 };
};

export const RecurrencePicker: FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [activeFreq, setActiveFreq] = useState<Freq>(value.freq);

  const handleTab = (next: Freq): void => {
    setActiveFreq(next);
    onChange(defaultForFreq(next));
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-ink">
        {t("routines.form.recurrence")}
      </label>
      <TabBar
        tabs={[
          { id: "daily", label: t("routines.form.freq.daily") },
          { id: "weekly", label: t("routines.form.freq.weekly") },
          { id: "monthly", label: t("routines.form.freq.monthly") },
          { id: "interval", label: t("routines.form.freq.interval") },
        ]}
        active={activeFreq}
        onSelect={(id) => handleTab(id as Freq)}
        variant="segmented"
      />
      <div className="pt-1">
        {value.freq === "daily" && (
          <div>
            <label className="block text-xs text-ink-muted mb-1">
              {t("routines.form.atMinute")}
            </label>
            <input
              type="time"
              value={formatAtMinute(value.atMinute)}
              onChange={(e) => onChange({ freq: "daily", atMinute: parseAtMinute(e.target.value) })}
              className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card"
            />
          </div>
        )}

        {value.freq === "weekly" && (
          <div className="flex gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {t("routines.form.weekday")}
              </label>
              <select
                value={value.weekday}
                onChange={(e) =>
                  onChange({
                    freq: "weekly",
                    weekday: Number(e.target.value),
                    atMinute: value.atMinute,
                  })
                }
                className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card"
              >
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {t(`routines.weekday.${String(d)}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {t("routines.form.atMinute")}
              </label>
              <input
                type="time"
                value={formatAtMinute(value.atMinute)}
                onChange={(e) =>
                  onChange({
                    freq: "weekly",
                    weekday: value.weekday,
                    atMinute: parseAtMinute(e.target.value),
                  })
                }
                className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card"
              />
            </div>
          </div>
        )}

        {value.freq === "monthly" && (
          <div className="flex gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {t("routines.form.monthDay")}
              </label>
              <input
                type="number"
                min={1}
                max={28}
                value={value.day}
                onChange={(e) =>
                  onChange({
                    freq: "monthly",
                    day: Math.max(1, Math.min(28, Number(e.target.value) || 1)),
                    atMinute: value.atMinute,
                  })
                }
                className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card w-20"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {t("routines.form.atMinute")}
              </label>
              <input
                type="time"
                value={formatAtMinute(value.atMinute)}
                onChange={(e) =>
                  onChange({
                    freq: "monthly",
                    day: value.day,
                    atMinute: parseAtMinute(e.target.value),
                  })
                }
                className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card"
              />
            </div>
          </div>
        )}

        {value.freq === "interval" && (
          <div>
            <label className="block text-xs text-ink-muted mb-1">
              {t("routines.form.everyMinutes")}
            </label>
            <input
              type="number"
              min={1}
              value={value.everyMinutes}
              onChange={(e) =>
                onChange({
                  freq: "interval",
                  everyMinutes: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card w-24"
            />
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
git add apps/renderer/src/components/routines/RecurrencePicker.tsx
git commit -m "feat(routines): add ui recurrence picker"
```

---

## Task 6: `EventPicker` + `TargetAgentPicker` components

**Files:**
- Create: `apps/renderer/src/components/routines/EventPicker.tsx`
- Create: `apps/renderer/src/components/routines/TargetAgentPicker.tsx`

- [ ] **Step 1: Create `EventPicker.tsx`**

Create `apps/renderer/src/components/routines/EventPicker.tsx`:

```typescript
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { EventSpec, RoutineEventType } from "@prospero/shared";

type Props = {
  value: EventSpec;
  onChange: (s: EventSpec) => void;
};

const EVENT_TYPES: RoutineEventType[] = [
  "goal_achieved",
  "verification_failed",
  "issue_done",
  "agent_recovered",
];

export const EventPicker: FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div>
      <label className="block text-xs font-semibold text-ink mb-1">
        {t("routines.form.event")}
      </label>
      <select
        value={value.eventType}
        onChange={(e) => onChange({ eventType: e.target.value as RoutineEventType })}
        className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card w-full max-w-xs"
      >
        {EVENT_TYPES.map((et) => (
          <option key={et} value={et}>
            {t(`routines.form.events.${et}`)}
          </option>
        ))}
      </select>
    </div>
  );
};
```

- [ ] **Step 2: Create `TargetAgentPicker.tsx`**

Create `apps/renderer/src/components/routines/TargetAgentPicker.tsx`:

```typescript
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { useAgentsStore } from "../../stores/agents.js";

type Props = {
  value: string | null;
  onChange: (id: string) => void;
};

export const TargetAgentPicker: FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) =>
    s.agents.filter((a) => a.status !== "terminated"),
  );

  if (agents.length === 0) {
    return (
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">
          {t("routines.form.targetAgent")}
        </label>
        <p className="text-xs text-ink-muted">{t("routines.form.targetAgentEmpty")}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-ink mb-1">
        {t("routines.form.targetAgent")}
      </label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card w-full max-w-md"
      >
        <option value="" disabled>
          {t("routines.form.targetAgentPlaceholder")}
        </option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.role})
          </option>
        ))}
      </select>
    </div>
  );
};
```

- [ ] **Step 3: Typecheck + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
git add apps/renderer/src/components/routines/EventPicker.tsx apps/renderer/src/components/routines/TargetAgentPicker.tsx
git commit -m "feat(routines): add ui event and target agent pickers"
```

---

## Task 7: `RoutineRow` component

**Files:**
- Create: `apps/renderer/src/components/routines/RoutineRow.tsx`

Context: Rich line (toggle + name + Run + sub-line). Click anywhere except controls → onClick. Stop propagation on toggle and run.

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/components/routines/RoutineRow.tsx`:

```typescript
import { useState, type FC, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Routine } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import {
  formatScheduleSummary,
  formatEventSummary,
  formatAtMinute,
} from "../../lib/routines/format-summary.js";

type Props = {
  routine: Routine;
  onToggle: () => Promise<void>;
  onRun: () => Promise<void>;
  onClick: () => void;
};

const formatRelative = (ts: number | null, neverLabel: string): string => {
  if (ts === null) return neverLabel;
  // For v1, plain HH:MM if today, else short date.
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

export const RoutineRow: FC<Props> = ({ routine, onToggle, onRun, onClick }) => {
  const { t } = useTranslation();
  const [runStatus, setRunStatus] = useState<"idle" | "fired" | "error">("idle");
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === routine.targetAgentId));

  const summary =
    routine.triggerType === "schedule" && routine.scheduleSpec !== null
      ? formatScheduleSummary(routine.scheduleSpec, t)
      : routine.eventSpec !== null
        ? formatEventSummary(routine.eventSpec, t)
        : "";

  const handleToggle = (e: MouseEvent): void => {
    e.stopPropagation();
    void onToggle();
  };

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

  const subLineParts: string[] = [summary];
  if (agent !== undefined) subLineParts.push(agent.name);
  if (routine.triggerType === "schedule") {
    if (routine.enabled && routine.nextFireAt !== null) {
      subLineParts.push(
        t("routines.row.nextFire", { when: formatRelative(routine.nextFireAt, "—") }),
      );
    } else if (!routine.enabled) {
      subLineParts.push(t("routines.row.paused"));
    }
    subLineParts.push(
      t("routines.row.lastFired", {
        when: formatRelative(routine.lastFiredAt, t("routines.row.neverFired")),
      }),
    );
  } else {
    subLineParts.push(
      t("routines.row.lastFired", {
        when: formatRelative(routine.lastFiredAt, t("routines.row.neverFired")),
      }),
    );
    if (!routine.enabled) subLineParts.push(t("routines.row.paused"));
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 border-b border-surface-border hover:bg-surface-soft transition-colors ${
        routine.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggle}
          aria-label={routine.enabled ? "disable" : "enable"}
          className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
            routine.enabled
              ? "bg-semantic-success border-semantic-success"
              : "bg-transparent border-ink-soft"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink truncate">{routine.name}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {runStatus === "fired" && (
            <span className="text-xs text-semantic-success">
              {t("routines.form.runNowFired")}
            </span>
          )}
          {runStatus === "error" && (
            <span className="text-xs text-semantic-danger">
              {t("routines.form.runNowError")}
            </span>
          )}
          <button
            type="button"
            onClick={handleRun}
            className="text-xs font-semibold px-2 py-0.5 rounded bg-surface-soft text-ink hover:bg-surface-border"
          >
            ▶ {t("routines.form.runNow")}
          </button>
        </div>
      </div>
      <div className="ml-6 mt-0.5 text-xs text-ink-muted truncate">
        {subLineParts.join(" · ")}
      </div>
    </button>
  );
};
```

- [ ] **Step 2: Typecheck + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
git add apps/renderer/src/components/routines/RoutineRow.tsx
git commit -m "feat(routines): add ui row component"
```

---

## Task 8: `RoutineForm` route — `/routines/new` + `/routines/:id`

**Files:**
- Create: `apps/renderer/src/routes/RoutineForm.tsx`

Context: Single route component that handles both create and edit via `useParams()`. Pre-fills from store in edit mode. Uses RecurrencePicker / EventPicker / TargetAgentPicker. Validation gates submit button. Banner on IPC error. Delete + Run Now buttons only in edit mode.

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/routes/RoutineForm.tsx`:

```typescript
import { useEffect, useState, type FC, type FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EventSpec, ScheduleSpec } from "@prospero/shared";
import { useRoutinesStore } from "../stores/routines.js";
import { useCompaniesStore } from "../stores/companies.js";
import { useAgentsStore } from "../stores/agents.js";
import { RecurrencePicker } from "../components/routines/RecurrencePicker.js";
import { EventPicker } from "../components/routines/EventPicker.js";
import { TargetAgentPicker } from "../components/routines/TargetAgentPicker.js";

type TriggerType = "schedule" | "event";

const DEFAULT_SCHEDULE: ScheduleSpec = { freq: "daily", atMinute: 540 };
const DEFAULT_EVENT: EventSpec = { eventType: "goal_achieved" };

export const RoutineForm: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = id !== undefined;

  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const routines = useRoutinesStore((s) => s.routines);
  const load = useRoutinesStore((s) => s.load);
  const getById = useRoutinesStore((s) => s.getById);
  const createFn = useRoutinesStore((s) => s.create);
  const updateFn = useRoutinesStore((s) => s.update);
  const deleteFn = useRoutinesStore((s) => s.delete);
  const runNowFn = useRoutinesStore((s) => s.runNow);
  const loadAgents = useAgentsStore((s) => s.load);
  const agentsLoaded = useAgentsStore((s) => s.loaded);

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [triggerType, setTriggerType] = useState<TriggerType>("schedule");
  const [scheduleSpec, setScheduleSpec] = useState<ScheduleSpec>(DEFAULT_SCHEDULE);
  const [eventSpec, setEventSpec] = useState<EventSpec>(DEFAULT_EVENT);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<"idle" | "fired" | "error">("idle");

  // Load routines (for edit lookup) + agents.
  useEffect(() => {
    if (activeCompanyId === null) return;
    if (routines === null) void load(activeCompanyId);
    if (!agentsLoaded) void loadAgents(activeCompanyId);
  }, [activeCompanyId, routines, load, agentsLoaded, loadAgents]);

  // Pre-fill in edit mode.
  useEffect(() => {
    if (!isEdit || id === undefined) return;
    const existing = getById(id);
    if (existing === null) return;
    setName(existing.name);
    setEnabled(existing.enabled);
    setTriggerType(existing.triggerType);
    if (existing.scheduleSpec !== null) setScheduleSpec(existing.scheduleSpec);
    if (existing.eventSpec !== null) setEventSpec(existing.eventSpec);
    setTargetAgentId(existing.targetAgentId);
    setInstruction(existing.instruction);
  }, [isEdit, id, getById, routines]);

  if (activeCompanyId === null) {
    return <div className="p-6 text-sm text-ink-muted">…</div>;
  }

  if (isEdit && routines !== null && getById(id ?? "") === null) {
    return (
      <div className="p-6">
        <p className="text-sm text-semantic-danger mb-3">{t("routines.form.notFound")}</p>
        <Link to="/routines" className="text-xs text-brand hover:underline">
          ← {t("routines.form.back")}
        </Link>
      </div>
    );
  }

  const canSubmit =
    name.trim().length > 0 &&
    name.trim().length <= 120 &&
    targetAgentId !== null &&
    targetAgentId !== "" &&
    instruction.trim().length > 0 &&
    instruction.trim().length <= 4000;

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit || activeCompanyId === null || targetAgentId === null) return;
    setSubmitting(true);
    setError(null);
    const baseInput = {
      companyId: activeCompanyId,
      name: name.trim(),
      enabled,
      triggerType,
      targetAgentId,
      instruction: instruction.trim(),
    };
    const payload =
      triggerType === "schedule"
        ? { ...baseInput, scheduleSpec }
        : { ...baseInput, eventSpec };
    try {
      if (isEdit && id !== undefined) {
        await updateFn({
          id,
          name: name.trim(),
          enabled,
          ...(triggerType === "schedule" ? { scheduleSpec } : { eventSpec }),
          targetAgentId,
          instruction: instruction.trim(),
        });
      } else {
        await createFn(payload);
      }
      navigate("/routines");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!isEdit || id === undefined) return;
    const existing = getById(id);
    if (existing === null) return;
    if (!window.confirm(t("routines.form.deleteConfirm", { name: existing.name }))) return;
    try {
      await deleteFn(id);
      navigate("/routines");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-2 text-xs text-ink-muted mb-3">
        <Link to="/routines" className="hover:text-ink">
          ← {t("routines.title")}
        </Link>
        <span>/</span>
        <span className="text-ink">
          {isEdit ? t("routines.form.header.edit") : t("routines.form.header.new")}
        </span>
      </div>

      {error !== null && (
        <div className="mb-4 p-2 bg-semantic-danger-bg text-semantic-danger text-xs rounded border border-semantic-danger">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="routine-name" className="block text-xs font-semibold text-ink mb-1">
            {t("routines.form.name")}
          </label>
          <input
            id="routine-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="w-full px-2 py-1.5 text-sm rounded border border-surface-border bg-surface-card"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            {t("routines.form.trigger")}
          </label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={triggerType === "schedule"}
                onChange={() => setTriggerType("schedule")}
              />
              {t("routines.form.triggerSchedule")}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={triggerType === "event"}
                onChange={() => setTriggerType("event")}
              />
              {t("routines.form.triggerEvent")}
            </label>
          </div>
        </div>

        {triggerType === "schedule" ? (
          <RecurrencePicker value={scheduleSpec} onChange={setScheduleSpec} />
        ) : (
          <EventPicker value={eventSpec} onChange={setEventSpec} />
        )}

        <TargetAgentPicker value={targetAgentId} onChange={setTargetAgentId} />

        <div>
          <label htmlFor="routine-instruction" className="block text-xs font-semibold text-ink mb-1">
            {t("routines.form.instruction")}
          </label>
          <textarea
            id="routine-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={4000}
            rows={4}
            className="w-full px-2 py-1.5 text-sm rounded border border-surface-border bg-surface-card resize-y"
          />
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-surface-border">
          <div className="flex items-center gap-2">
            {isEdit && (
              <>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="text-xs px-3 py-1.5 rounded text-semantic-danger hover:bg-semantic-danger-bg"
                >
                  {t("routines.form.delete")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunNow()}
                  className="text-xs px-3 py-1.5 rounded bg-surface-soft text-ink hover:bg-surface-border"
                >
                  ▶ {t("routines.form.runNow")}
                </button>
                {runStatus === "fired" && (
                  <span className="text-xs text-semantic-success">
                    {t("routines.form.runNowFired")}
                  </span>
                )}
                {runStatus === "error" && (
                  <span className="text-xs text-semantic-danger">
                    {t("routines.form.runNowError")}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/routines")}
              className="text-xs px-3 py-1.5 rounded text-ink-muted hover:bg-surface-soft"
            >
              {t("routines.form.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-brand text-white disabled:opacity-50"
            >
              {submitting
                ? t("routines.form.saving")
                : isEdit
                  ? t("routines.form.save")
                  : t("routines.form.create")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
git add apps/renderer/src/routes/RoutineForm.tsx
git commit -m "feat(routines): add ui form route"
```

---

## Task 9: `Routines` list route

**Files:**
- Create: `apps/renderer/src/routes/Routines.tsx`

Context: Header + list of `<RoutineRow>` or empty state. Click row → navigate `/routines/:id`. `+ Nova routine` no header → `/routines/new`.

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/routes/Routines.tsx`:

```typescript
import { useEffect, type FC } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRoutinesStore } from "../stores/routines.js";
import { useCompaniesStore } from "../stores/companies.js";
import { useAgentsStore } from "../stores/agents.js";
import { RoutineRow } from "../components/routines/RoutineRow.js";
import { EmptyState } from "../components/ui/EmptyState.js";

export const Routines: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const routines = useRoutinesStore((s) => s.routines);
  const loading = useRoutinesStore((s) => s.loading);
  const error = useRoutinesStore((s) => s.error);
  const load = useRoutinesStore((s) => s.load);
  const toggleEnabled = useRoutinesStore((s) => s.toggleEnabled);
  const runNow = useRoutinesStore((s) => s.runNow);
  const loadAgents = useAgentsStore((s) => s.load);
  const agentsLoaded = useAgentsStore((s) => s.loaded);

  useEffect(() => {
    if (activeCompanyId === null) return;
    void load(activeCompanyId);
    if (!agentsLoaded) void loadAgents(activeCompanyId);
  }, [activeCompanyId, load, agentsLoaded, loadAgents]);

  if (activeCompanyId === null) {
    return <div className="p-6 text-sm text-ink-muted">…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-brand-dark">{t("routines.title")}</h1>
          <p className="text-xs text-ink-muted mt-0.5">{t("routines.subtitle")}</p>
        </div>
        <Link
          to="/routines/new"
          className="text-xs font-semibold px-3 py-1.5 rounded bg-brand text-white"
        >
          + {t("routines.new")}
        </Link>
      </header>

      {error !== null && (
        <div className="mb-4 p-2 bg-semantic-danger-bg text-semantic-danger text-xs rounded border border-semantic-danger">
          {error}
        </div>
      )}

      {loading && routines === null ? (
        <p className="text-xs text-ink-muted p-2">…</p>
      ) : routines === null || routines.length === 0 ? (
        <EmptyState
          message={t("routines.empty.description")}
          icon={<span aria-hidden>⏱</span>}
        />
      ) : (
        <div className="border-t border-surface-border bg-surface-card rounded">
          {routines.map((r) => (
            <RoutineRow
              key={r.id}
              routine={r}
              onToggle={() => toggleEnabled(r.id)}
              onRun={() => runNow(r.id)}
              onClick={() => navigate(`/routines/${r.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
```

Note: the EmptyState primitive only takes `message` and `icon`. CTA (`+ Nova routine`) already lives in the page header, so the empty state doesn't need a button — clicking the header CTA still works when the page is empty.

- [ ] **Step 2: Typecheck + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
git add apps/renderer/src/routes/Routines.tsx
git commit -m "feat(routines): add ui list route"
```

---

## Task 10: Wire routes + sidebar entry in `App.tsx`

**Files:**
- Modify: `apps/renderer/src/App.tsx` (imports + Sidebar nav + Routes)

Context: Add 3 imports for Routines + RoutineForm. Insert a `<NavLink>` for `/routines` in the Sidebar between Briefing and Inbox. Register 3 routes inside the existing `<Routes>` block.

- [ ] **Step 1: Add the imports**

Open `apps/renderer/src/App.tsx`. Find the existing imports block at the top. After the line `import { Briefing } from "./routes/Briefing.js";`, add:

```typescript
import { Routines } from "./routes/Routines.js";
import { RoutineForm } from "./routes/RoutineForm.js";
```

- [ ] **Step 2: Add the Sidebar NavLink**

In `App.tsx`, find the Sidebar component (`const Sidebar = () => {`). Inside the `<nav>` block, locate the NavLink for `/briefing` (around lines 61-68). Right after the closing `</NavLink>` of `/briefing` and before the NavLink for `/dashboard`, insert:

```typescript
        <NavLink
          to="/routines"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.routines")}
        </NavLink>
```

- [ ] **Step 3: Register the routes**

In `App.tsx`, find the `<Routes>` block inside the App component (search for `<Route path="/briefing"`). Right after the existing `/briefing` route, insert these three lines:

```typescript
            <Route
              path="/routines"
              element={
                <Layout>
                  <Routines />
                </Layout>
              }
            />
            <Route
              path="/routines/new"
              element={
                <Layout>
                  <RoutineForm />
                </Layout>
              }
            />
            <Route
              path="/routines/:id"
              element={
                <Layout>
                  <RoutineForm />
                </Layout>
              }
            />
```

(Match the indentation and JSX shape of the surrounding `<Route>` elements in the file — they may use a slightly different wrapping pattern; match what's there exactly.)

- [ ] **Step 4: Typecheck + full renderer suite**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm --filter @prospero/renderer test
```

Expected: typecheck green; renderer suite green (no new tests in this task, but Task 3 and Task 4 added ~26 new ones earlier).

- [ ] **Step 5: Full main + shared + renderer + lint**

```powershell
pnpm --filter @prospero/main test
pnpm --filter @prospero/shared test
pnpm lint
```

Expected: all green.

- [ ] **Step 6: Pre-commit sanity**

```powershell
git status --short
git diff HEAD --stat
```

Confirm: only `apps/renderer/src/App.tsx` changed.

- [ ] **Step 7: Commit**

```powershell
git add apps/renderer/src/App.tsx
git commit -m "feat(routines): wire routes and sidebar nav"
```

---

## Final verification

- [ ] **Step 1: Full suite**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm test
```

Expected:
- typecheck: 4 packages green.
- lint: 4 packages green.
- test: all 4 packages green. Approx test deltas vs HEAD `07aeff7` (1712 passing):
  - main: +1 (Task 1)
  - renderer: +17 (Task 3 format-summary) + 9 (Task 4 store) = +26
  - total: ~1739 passing

- [ ] **Step 2: Inspect commit graph**

```powershell
git log --oneline 07aeff7..HEAD
```

Expected: ~10 commits, scoped to one task each.

- [ ] **Step 3: Smoke check (manual, not blocking)**

Start the dev app (`pnpm dev`), click "Routines" in the sidebar. Confirm:
- Empty state renders with subtitle and `+ Nova routine` button.
- Click `+ Nova routine` → form opens with daily 09:00 default + agent picker populated.
- Submit a valid routine → returns to list, row appears.
- Click row → form pre-filled.
- Toggle → optimistic flip.
- "Rodar agora" → 2s "Disparada" feedback.
- Edit recurrence to a different time → save → next-fire updates (bug-fix from Task 1).

If `pnpm dev` cannot run (Electron not available in some envs), skip this step and rely on typecheck + tests.

- [ ] **Step 4: ROADMAP update**

Open `ROADMAP.md`. Update the "▸ Agora" entry under M15 to indicate PR-B mergeado. Append PR-B summary to "Status atual" → "Concluído recentemente". Bump test count.

Suggested ROADMAP entry copy (adapt to current state):

> **M15 PR-B ✅ MERGEADO** (2026-05-XX) — UI das Routines. Rota `/routines` lista (linha rica com toggle inline · "Rodar agora" · summary formatter pt/en) + rotas `/routines/new` e `/routines/:id` no form dedicado com picker de recorrência em 4 tabs (diário/semanal/mensal/intervalo) e dropdown dos 4 eventos. Bug-fix: `routines:update` re-semeia `nextFireAt` quando `scheduleSpec` muda. +X testes.

Commit:

```powershell
git add ROADMAP.md
git commit -m "docs(roadmap): record m15 pr-b routines ui mergeado"
```

- [ ] **Step 5: Memory + push**

Write a `project_m15_pr_b_lessons.md` capturing:
- HEAD SHA, commit count, test delta.
- Key decisions: form em rota dedicada, picker em tabs, lista em linha rica.
- Any surprises encountered during implementation.
- Bug-fix do PR-A absorvido (re-seed nextFireAt).

Update `MEMORY.md` index with a one-line entry. Update `project_session_handoff.md` with new HEAD + "PR-B fechado, próximo PR-C consolidação".

```powershell
git push origin main
```

---

## Notes for the implementer

- All component files except `format-summary.ts` and `routines.ts` are renderer-pure (no tests). This matches the codebase convention (lesson [[project-m11-pr-c-ui-lessons]]): renderer doesn't use react-testing-library; visual coverage comes from smoke manual. Functional logic in `lib/` and `stores/` gets tests; presentation in `components/` and `routes/` does not.
- The window bridge uses `window.prospero.routines.*` (not `window.api.*`). All zustand stores in this codebase use this prefix — see `briefing.ts`.
- The `EmptyState` primitive (`apps/renderer/src/components/ui/EmptyState.tsx`) has a minimal API: `{ message: string; icon?: ReactNode }`. It does NOT take a CTA. The page header carries the `+ Nova routine` CTA; when the list is empty, the user clicks that header button.
- The `TabBar` primitive supports `variant="segmented" | "underline"`. We use `"segmented"` for the recurrence picker.
- Confirm dialogs use `window.confirm` directly (project pattern; see `agents.ts:terminate` call sites).
- The i18next `t()` interpolation uses `{{name}}` syntax (double curly), not `{name}`. The provided JSON values reflect this.
- The `eventLabelKey` helper in `format-summary.ts` returns the i18n key path; the caller passes it through `t` to resolve.
- Route file `RoutineForm.tsx` covers BOTH `/routines/new` AND `/routines/:id`. The `useParams<{ id?: string }>()` discriminates. Two `<Route>` elements register the same component under different paths.
- When the renderer subscribes to inbox updates or activity events for live refresh, see `briefing.ts:subscribeInbox` for the pattern. **For PR-B v1, the list does NOT auto-refresh on routine.fired** — keep scope tight. If the user disparou via "Rodar agora", they see the inline status; the actual fired/skipped activity will show up next time they reload the list. Live refresh is a PR-C polish if needed.
- If `pnpm typecheck` fails on a discriminated-union narrowing inside `RoutineForm`, it's likely because TypeScript can't narrow `scheduleSpec`/`eventSpec` through `triggerType` setState. The fix is to use spread-only-defined when constructing the payload (already shown in Task 8). Don't fight TypeScript — that pattern is the local idiom (lesson `project_m15_pr_a_lessons` item 2).
