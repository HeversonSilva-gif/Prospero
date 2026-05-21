# "Pedir algo" (conversa → plano) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the technical Goals form behind "Pedir algo" with a real conversation with the CEO that ends in a dedicated plain-language plan-review page (Approve / Adjust).

**Architecture:** Reuse the existing Goal-plan backend untouched. `/goals/new` becomes a conversational view (`PedirAlgo`): the first message creates a draft goal (`goals.create`) and starts a normal chat with the CEO agent (`agents.sendMessage`); the chat reuses `MessageList` + `Composer`. An explicit "Montar o plano" action calls `goals.requestPlan` (the CEO, which already has the conversation in its session, responds by calling `submit_goal_plan`); the view polls `goals.get` until a `proposed` plan appears and offers "Ver plano". A new `PlanoRevisao` page renders the plan in plain language (O que vai ser feito / Quem vai fazer / Tempo e custo) reusing `GoalPlan` data + `computeFilteredEstimates`, wired to `goals.approvePlan`. "Quero ajustar" returns to the conversation, where "Refazer o plano" re-runs `goals.requestPlan` (it supersedes the prior proposed plan).

**Tech Stack:** React 18 + TypeScript (strict, `exactOptionalPropertyTypes`), react-router-dom, zustand stores, react-i18next, Tailwind tokens. Vitest for pure-logic tests. Renderer has **no** react-testing-library — UI is verified by typecheck + lint + i18n parity + manual smoke (the user's packaged-app flow).

**Key risk (from spec):** the CEO actually producing a valid plan from `requestPlan` was never smoke-tested live. Task 3 ends with a manual DE-RISK checkpoint; do not build Task 4's polished review page until the CEO is confirmed to produce a plan.

---

## File Structure

- Create `apps/renderer/src/lib/pedir.ts` — pure helpers: `deriveGoalTitle`, `scopeUserMessages`.
- Create `apps/renderer/src/lib/pedir.test.ts` — unit tests for the helpers.
- Create `apps/renderer/src/routes/PedirAlgo.tsx` — the conversational view (handles `/goals/new` empty state and `/pedir/:goalId` conversation).
- Create `apps/renderer/src/routes/PlanoRevisao.tsx` — the plain-language plan-review page (`/pedir/:goalId/plano`).
- Modify `apps/renderer/src/App.tsx` — point `/goals/new` at `PedirAlgo`; add routes `/pedir/:goalId` and `/pedir/:goalId/plano`.
- Modify `apps/renderer/src/i18n/pt-BR.json` + `en-US.json` — add `pedir.*` conversation/review keys; remove the now-dead `pedir.panel.*` keys.
- Modify `apps/renderer/src/i18n/parity.test.ts` — add a `pedir.*` assertion block.
- Delete `apps/renderer/src/routes/GoalNew.tsx` — superseded by `PedirAlgo` (after no imports remain).

Reused as-is: `components/MessageList.tsx`, `components/Composer.tsx`, `lib/planValidation.ts` (`computeFilteredEstimates`, `validatePlanSelection`, `PlanFilter`), stores `useAgentsStore`, and the `window.prospero.{goals,agents,messages,companies}` IPC surface. `GoalDetail` (technical 5-tab page at `/goals/:id`) is left untouched for advanced use.

---

### Task 1: Pure helpers (`lib/pedir.ts`)

**Files:**
- Create: `apps/renderer/src/lib/pedir.ts`
- Test: `apps/renderer/src/lib/pedir.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/renderer/src/lib/pedir.test.ts
import { describe, expect, it } from "vitest";
import type { Message } from "@prospero/shared";
import { deriveGoalTitle, scopeUserMessages } from "./pedir.js";

describe("deriveGoalTitle", () => {
  it("uses the first line, trimmed", () => {
    expect(deriveGoalTitle("Quero abrir uma loja\nde velas")).toBe("Quero abrir uma loja");
  });
  it("truncates long single lines to 80 chars with an ellipsis", () => {
    const long = "a".repeat(100);
    const title = deriveGoalTitle(long);
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
  });
  it("falls back to a default for empty input", () => {
    expect(deriveGoalTitle("   ")).toBe("Novo pedido");
  });
});

const msg = (over: Partial<Message>): Message =>
  ({
    id: "m",
    companyId: "c",
    senderKind: "user",
    senderId: null,
    content: "x",
    kind: "message",
    createdAt: 0,
    ...over,
  }) as Message;

describe("scopeUserMessages", () => {
  it("keeps only messages at/after the cutoff", () => {
    const out = scopeUserMessages([msg({ id: "a", createdAt: 5 }), msg({ id: "b", createdAt: 15 })], 10);
    expect(out.map((m) => m.id)).toEqual(["b"]);
  });
  it("drops delegation messages (threadParticipants without 'user')", () => {
    const out = scopeUserMessages(
      [
        msg({ id: "chat", createdAt: 20, threadParticipants: ["user", "ceo"] }),
        msg({ id: "deleg", createdAt: 20, threadParticipants: ["ceo", "worker"] }),
      ],
      10,
    );
    expect(out.map((m) => m.id)).toEqual(["chat"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/renderer test -- pedir`
Expected: FAIL — `Cannot find module './pedir.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/renderer/src/lib/pedir.ts
import type { Message } from "@prospero/shared";

const TITLE_MAX = 80;

/** Plain-language goal title derived from the owner's first request: first
 *  non-empty line, trimmed, truncated to 80 chars. */
export const deriveGoalTitle = (request: string): string => {
  const firstLine = request.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  if (firstLine === "") return "Novo pedido";
  if (firstLine.length <= TITLE_MAX) return firstLine;
  return firstLine.slice(0, TITLE_MAX - 1) + "…";
};

/** Messages belonging to THIS request: the CEO thread filtered to the user-facing
 *  chat (threadParticipants undefined or including "user") at/after the goal's
 *  createdAt. Keeps the conversation scoped to one request. */
export const scopeUserMessages = (messages: Message[], sinceMs: number): Message[] =>
  messages.filter(
    (m) =>
      m.createdAt >= sinceMs &&
      (m.threadParticipants === undefined || m.threadParticipants.includes("user")),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/renderer test -- pedir`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/lib/pedir.ts apps/renderer/src/lib/pedir.test.ts
git commit -m "feat(m16): pedir-algo title + message-scoping helpers"
```

---

### Task 2: i18n keys (conversation + review)

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json` (the `pedir` object)
- Modify: `apps/renderer/src/i18n/en-US.json` (the `pedir` object)
- Modify: `apps/renderer/src/i18n/parity.test.ts`

The current `pedir` object is `{ title, subtitle, panel: { title, steps } }`. `panel.*` was the old form's aside and is removed. Replace the whole `pedir` object.

- [ ] **Step 1: Replace the `pedir` object in `pt-BR.json`**

```json
  "pedir": {
    "title": "Pedir algo",
    "subtitle": "Descreva o que você precisa. O CEO conversa com você e monta um plano.",
    "placeholder": "Ex.: quero abrir uma loja online de velas artesanais e começar a vender ainda este mês…",
    "start": "Pedir",
    "noCeo": "Nenhum CEO na sua empresa ainda.",
    "ceoThinking": "O CEO está pensando…",
    "buildPlan": "Montar o plano",
    "rebuildPlan": "Refazer o plano",
    "buildingPlan": "Montando o plano…",
    "planReady": "Seu plano está pronto.",
    "viewPlan": "Ver plano",
    "newRequest": "Novo pedido",
    "plano": {
      "title": "Seu plano",
      "for": "Para",
      "whatWillBeDone": "O que vai ser feito",
      "whoWillDo": "Quem vai fazer",
      "newHires_one": "{{count}} funcionário novo · {{roles}}",
      "newHires_other": "{{count}} funcionários novos · {{roles}}",
      "noHires": "Ninguém novo — sua equipe atual dá conta.",
      "timeAndCost": "Tempo e custo",
      "days_one": "cerca de {{count}} dia",
      "days_other": "cerca de {{count}} dias",
      "cost": "~{{value}} em uso de IA",
      "approve": "Aprovar e começar",
      "approving": "Começando…",
      "adjust": "Quero ajustar",
      "backToChat": "Voltar à conversa",
      "notReady": "Ainda não há um plano pronto para este pedido.",
      "empty": "Sem itens."
    }
  }
```

- [ ] **Step 2: Replace the `pedir` object in `en-US.json`**

```json
  "pedir": {
    "title": "Ask for something",
    "subtitle": "Describe what you need. The CEO talks it through with you and builds a plan.",
    "placeholder": "e.g. I want to open an online store for handmade candles and start selling this month…",
    "start": "Ask",
    "noCeo": "No CEO in your company yet.",
    "ceoThinking": "The CEO is thinking…",
    "buildPlan": "Build the plan",
    "rebuildPlan": "Rebuild the plan",
    "buildingPlan": "Building the plan…",
    "planReady": "Your plan is ready.",
    "viewPlan": "View plan",
    "newRequest": "New request",
    "plano": {
      "title": "Your plan",
      "for": "For",
      "whatWillBeDone": "What will be done",
      "whoWillDo": "Who will do it",
      "newHires_one": "{{count}} new hire · {{roles}}",
      "newHires_other": "{{count}} new hires · {{roles}}",
      "noHires": "No new hires — your current team can handle it.",
      "timeAndCost": "Time and cost",
      "days_one": "about {{count}} day",
      "days_other": "about {{count}} days",
      "cost": "~{{value}} in AI usage",
      "approve": "Approve and start",
      "approving": "Starting…",
      "adjust": "I want to adjust",
      "backToChat": "Back to the conversation",
      "notReady": "There is no ready plan for this request yet.",
      "empty": "No items."
    }
  }
```

- [ ] **Step 3: Add a parity assertion block in `parity.test.ts`** (before the final closing `});` of the `describe`)

```ts
  it("includes the M16 pedir-algo keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "pedir.title",
      "pedir.placeholder",
      "pedir.buildPlan",
      "pedir.viewPlan",
      "pedir.plano.whatWillBeDone",
      "pedir.plano.whoWillDo",
      "pedir.plano.timeAndCost",
      "pedir.plano.approve",
      "pedir.plano.adjust",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
```

- [ ] **Step 4: Run the parity test**

Run: `pnpm --filter @prospero/renderer test -- parity`
Expected: PASS. (If it fails with `ptOnly`/`enOnly` non-empty, a key is missing/typo'd in one locale — fix to match.)

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m16): pedir-algo conversation and plan i18n keys"
```

---

### Task 3: `PedirAlgo` conversational view  ·  DE-RISK CHECKPOINT

**Files:**
- Create: `apps/renderer/src/routes/PedirAlgo.tsx`
- Modify: `apps/renderer/src/App.tsx` (route `/goals/new` → `PedirAlgo`; add `/pedir/:goalId`)

Reuses `MessageList`, `Composer`, `useAgentsStore`, the helpers from Task 1, and `window.prospero.{companies,goals,agents,messages}`.

- [ ] **Step 1: Write `PedirAlgo.tsx`**

```tsx
// apps/renderer/src/routes/PedirAlgo.tsx
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GoalWithPlan, Message } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { MessageList } from "../components/MessageList.js";
import { Composer } from "../components/Composer.js";
import { deriveGoalTitle, scopeUserMessages } from "../lib/pedir.js";

export const PedirAlgo: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { goalId } = useParams<{ goalId?: string }>();
  const agents = useAgentsStore((s) => s.agents);
  const ceo = useMemo(
    () => agents.find((a) => a.role === "ceo" || a.templateId === "ceo") ?? null,
    [agents],
  );

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [goal, setGoal] = useState<GoalWithPlan | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    void (async () => {
      const cs = await window.prospero.companies.list();
      if (cs.length > 0) setCompanyId(cs[0]!.id);
    })();
  }, []);

  // Load goal + scoped conversation when viewing an in-progress request.
  const reload = useMemo(
    () => async () => {
      if (goalId === undefined || ceo === null) return;
      const g = await window.prospero.goals.get({ id: goalId });
      setGoal(g);
      const all = await window.prospero.messages.listByAgent(ceo.id);
      setMessages(scopeUserMessages(all, g.createdAt));
    },
    [goalId, ceo],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live updates: the CEO replies / produces a plan in the background.
  useEffect(() => {
    if (goalId === undefined || ceo === null) return;
    const off = window.prospero.agents.onEvent((ev) => {
      if (ev.kind === "message-append" && ev.agentId === ceo.id) void reload();
    });
    return off;
  }, [goalId, ceo, reload]);

  // While we asked for a plan but it has not landed yet, poll for it.
  const planning = goal !== null && goal.status === "planning" && goal.currentPlan === null;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!planning) return;
    pollRef.current = setInterval(() => void reload(), 3000);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [planning, reload]);

  const planReady = goal?.currentPlan != null && goal.currentPlan.status === "proposed";

  const start = async () => {
    if (companyId === null || ceo === null || draft.trim() === "") return;
    setStarting(true);
    try {
      const created = await window.prospero.goals.create({
        companyId,
        title: deriveGoalTitle(draft),
        description: draft.trim(),
        level: "company",
      });
      await window.prospero.agents.sendMessage(ceo.id, draft.trim());
      navigate(`/pedir/${created.id}`);
    } finally {
      setStarting(false);
    }
  };

  const sendReply = async (text: string) => {
    if (ceo === null) return;
    await window.prospero.agents.sendMessage(ceo.id, text);
    await reload();
  };

  const requestPlan = async () => {
    if (goalId === undefined) return;
    setRequesting(true);
    try {
      await window.prospero.goals.requestPlan({ goalId });
      await reload();
    } finally {
      setRequesting(false);
    }
  };

  if (ceo === null) {
    return <div className="p-8 text-sm text-ink-muted">{t("pedir.noCeo")}</div>;
  }

  // Empty state — new request.
  if (goalId === undefined) {
    return (
      <div className="flex flex-col h-full">
        <header className="px-8 py-6 border-b border-surface-border bg-surface">
          <h1 className="text-2xl font-bold text-ink">{t("pedir.title")}</h1>
          <p className="mt-1 text-sm text-ink-soft">{t("pedir.subtitle")}</p>
        </header>
        <div className="flex-1 overflow-auto p-8 max-w-2xl w-full mx-auto">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder={t("pedir.placeholder")}
            className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
          />
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting || draft.trim() === ""}
            className="mt-3 px-4 py-2 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
          >
            {t("pedir.start")}
          </button>
        </div>
      </div>
    );
  }

  // Conversation view for an in-progress request.
  return (
    <div className="flex flex-col h-full min-w-0">
      <header className="px-6 py-4 border-b border-surface-border bg-surface flex items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink truncate">{goal?.title ?? t("pedir.title")}</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/goals/new")}
          className="ml-auto text-xs px-2.5 py-1 bg-surface-soft text-ink-muted rounded hover:text-ink"
        >
          {t("pedir.newRequest")}
        </button>
      </header>

      {planReady && (
        <div className="px-6 py-2 bg-semantic-success/10 border-b border-surface-border flex items-center gap-3">
          <span className="text-sm text-ink">{t("pedir.planReady")}</span>
          <button
            type="button"
            onClick={() => navigate(`/pedir/${goalId}/plano`)}
            className="ml-auto text-xs px-3 py-1.5 bg-semantic-success text-white rounded font-semibold"
          >
            {t("pedir.viewPlan")}
          </button>
        </div>
      )}

      <MessageList messages={messages} agents={agents} />

      <div className="px-6 py-2 border-t border-surface-border flex items-center gap-2">
        <button
          type="button"
          onClick={() => void requestPlan()}
          disabled={requesting || planning}
          className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
        >
          {planning
            ? t("pedir.buildingPlan")
            : planReady
              ? t("pedir.rebuildPlan")
              : t("pedir.buildPlan")}
        </button>
        {planning && <span className="text-xs text-ink-soft">{t("pedir.ceoThinking")}</span>}
      </div>

      <Composer onSubmit={(text) => void sendReply(text)} />
    </div>
  );
};

export default PedirAlgo;
```

- [ ] **Step 2: Wire routes in `App.tsx`**

Replace the lazy import (line ~38) `const GoalNew = lazy(() => import("./routes/GoalNew.js"));` with:

```tsx
const PedirAlgo = lazy(() => import("./routes/PedirAlgo.js"));
```

Change the `/goals/new` route element to render `<PedirAlgo />` instead of `<GoalNew />` (keep the same `appReady ? <Layout><Suspense …><PedirAlgo /></Suspense></Layout> : <Navigate to="/setup" replace />` wrapper).

Add a new route immediately after the `/goals/new` route, mirroring the same wrapper:

```tsx
<Route
  path="/pedir/:goalId"
  element={
    appReady ? (
      <Layout>
        <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
          <PedirAlgo />
        </Suspense>
      </Layout>
    ) : (
      <Navigate to="/setup" replace />
    )
  }
/>
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @prospero/renderer run typecheck && pnpm --filter @prospero/renderer run lint`
Expected: clean. (Watch for `exactOptionalPropertyTypes`: every `goals.create` field used is required or a concrete value, so no conditional-spread needed here.)

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/routes/PedirAlgo.tsx apps/renderer/src/App.tsx
git commit -m "feat(m16): pedir-algo conversational view replaces goals form"
```

- [ ] **Step 5: DE-RISK manual smoke (BLOCKING before Task 4)**

Rebuild (`pnpm dist:win`) or run dev, then: open "Pedir algo" → type a request (e.g. "quero abrir uma loja de velas") → send → confirm the CEO replies in the chat → click "Montar o plano" → confirm within ~30–60s the goal reaches a `proposed` plan and the "Ver plano" banner appears.
**If the CEO does not reliably produce a plan, STOP and report** — the spec's key risk has materialized; revisit the approach (e.g. add a clarifying-then-plan CEO prompt variant) before investing in Task 4.

---

### Task 4: `PlanoRevisao` plain-language review page

**Files:**
- Create: `apps/renderer/src/routes/PlanoRevisao.tsx`
- Modify: `apps/renderer/src/App.tsx` (add `/pedir/:goalId/plano`)

Reuses `computeFilteredEstimates` + `PlanFilter` from `lib/planValidation.ts`, `formatCents` pattern, and `window.prospero.goals.{get,approvePlan}`.

- [ ] **Step 1: Write `PlanoRevisao.tsx`**

```tsx
// apps/renderer/src/routes/PlanoRevisao.tsx
import { useEffect, useMemo, useState, type FC } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GoalWithPlan } from "@prospero/shared";
import { computeFilteredEstimates, type PlanFilter } from "../lib/planValidation.js";

const fmtCents = (cents: number): string => `R$ ${(cents / 100).toFixed(2)}`;

export const PlanoRevisao: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { goalId } = useParams<{ goalId: string }>();
  const [goal, setGoal] = useState<GoalWithPlan | null>(null);
  const [filter, setFilter] = useState<PlanFilter | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (goalId === undefined) return;
      const g = await window.prospero.goals.get({ id: goalId });
      setGoal(g);
      if (g.currentPlan !== null) {
        setFilter({
          includedAgentIndexes: new Set(g.currentPlan.agentsToHire.map((a) => a.index)),
          includedIssueIndexes: new Set(g.currentPlan.issuesToCreate.map((i) => i.index)),
        });
      }
    })();
  }, [goalId]);

  const plan = goal?.currentPlan ?? null;
  const estimates = useMemo(
    () => (plan !== null && filter !== null ? computeFilteredEstimates(plan, filter) : null),
    [plan, filter],
  );

  if (goalId === undefined) return null;

  if (plan === null || filter === null) {
    return (
      <div className="p-8 max-w-2xl">
        <button
          type="button"
          onClick={() => navigate(`/pedir/${goalId}`)}
          className="text-xs text-brand hover:underline mb-3"
        >
          ← {t("pedir.plano.backToChat")}
        </button>
        <p className="text-sm text-ink-muted">{t("pedir.plano.notReady")}</p>
      </div>
    );
  }

  const toggleAgent = (idx: number) =>
    setFilter((cur) => {
      if (cur === null) return cur;
      const next = new Set(cur.includedAgentIndexes);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return { ...cur, includedAgentIndexes: next };
    });
  const toggleIssue = (idx: number) =>
    setFilter((cur) => {
      if (cur === null) return cur;
      const next = new Set(cur.includedIssueIndexes);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return { ...cur, includedIssueIndexes: next };
    });

  const includedAgents = plan.agentsToHire.filter((a) => filter.includedAgentIndexes.has(a.index));
  const hireRoles = includedAgents.map((a) => a.name).join(", ");

  const approve = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const opts: { includeAgentIndexes?: number[]; includeIssueIndexes?: number[]; mode?: "atomic" } =
        { mode: "atomic" };
      if (filter.includedAgentIndexes.size < plan.agentsToHire.length) {
        opts.includeAgentIndexes = [...filter.includedAgentIndexes];
      }
      if (filter.includedIssueIndexes.size < plan.issuesToCreate.length) {
        opts.includeIssueIndexes = [...filter.includedIssueIndexes];
      }
      const result = await window.prospero.goals.approvePlan({ planId: plan.id, ...opts });
      if (result.ok) navigate("/projetos");
      else setError(`${result.failedAtStep}: ${result.error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-8 py-5 border-b border-surface-border bg-surface">
        <button
          type="button"
          onClick={() => navigate(`/pedir/${goalId}`)}
          className="text-xs text-brand hover:underline"
        >
          ← {t("pedir.plano.backToChat")}
        </button>
        <h1 className="mt-1 text-2xl font-bold text-ink">{t("pedir.plano.title")}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t("pedir.plano.for")}: {goal?.title}
        </p>
      </header>

      <div className="flex-1 overflow-auto p-8 max-w-2xl w-full mx-auto space-y-6">
        <section>
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-ink-soft mb-2">
            {t("pedir.plano.whatWillBeDone")}
          </h2>
          {plan.issuesToCreate.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("pedir.plano.empty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {plan.issuesToCreate.map((i) => (
                <li key={i.index} className="flex items-center gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={filter.includedIssueIndexes.has(i.index)}
                    onChange={() => toggleIssue(i.index)}
                    className="w-4 h-4"
                  />
                  <span className={filter.includedIssueIndexes.has(i.index) ? "" : "opacity-50 line-through"}>
                    {i.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-ink-soft mb-2">
            {t("pedir.plano.whoWillDo")}
          </h2>
          {plan.agentsToHire.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("pedir.plano.noHires")}</p>
          ) : (
            <ul className="space-y-1.5">
              {plan.agentsToHire.map((a) => (
                <li key={a.index} className="flex items-center gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={filter.includedAgentIndexes.has(a.index)}
                    onChange={() => toggleAgent(a.index)}
                    className="w-4 h-4"
                  />
                  <span className={filter.includedAgentIndexes.has(a.index) ? "" : "opacity-50"}>
                    {a.name} <span className="text-ink-soft">· {a.roleTemplateId}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-ink-soft mb-2">
            {t("pedir.plano.timeAndCost")}
          </h2>
          <p className="text-sm text-ink-muted">
            {estimates?.durationDays != null && t("pedir.plano.days", { count: estimates.durationDays })}
            {estimates?.durationDays != null && estimates.costCents != null && " · "}
            {estimates?.costCents != null && t("pedir.plano.cost", { value: fmtCents(estimates.costCents) })}
          </p>
        </section>
      </div>

      <div className="px-8 py-4 border-t border-surface-border flex gap-3">
        <button
          type="button"
          onClick={() => void approve()}
          disabled={submitting}
          className="px-4 py-2 bg-semantic-success text-white text-sm rounded font-semibold disabled:opacity-50"
        >
          {submitting ? t("pedir.plano.approving") : t("pedir.plano.approve")}
        </button>
        <button
          type="button"
          onClick={() => navigate(`/pedir/${goalId}`)}
          className="px-4 py-2 bg-surface-soft text-ink-muted text-sm rounded font-semibold"
        >
          {t("pedir.plano.adjust")}
        </button>
        {error !== null && <p className="basis-full text-sm text-semantic-danger">{error}</p>}
      </div>
    </div>
  );
};

export default PlanoRevisao;
```

- [ ] **Step 2: Wire the route in `App.tsx`**

Add the lazy import near `PedirAlgo`:

```tsx
const PlanoRevisao = lazy(() => import("./routes/PlanoRevisao.js"));
```

Add the route after `/pedir/:goalId`, mirroring the same `appReady`/`Layout`/`Suspense` wrapper:

```tsx
<Route
  path="/pedir/:goalId/plano"
  element={
    appReady ? (
      <Layout>
        <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
          <PlanoRevisao />
        </Suspense>
      </Layout>
    ) : (
      <Navigate to="/setup" replace />
    )
  }
/>
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @prospero/renderer run typecheck && pnpm --filter @prospero/renderer run lint`
Expected: clean. (`approvePlan` opts uses conditional spread to satisfy `exactOptionalPropertyTypes`; `mode: "atomic"` is always set. Confirm `PlanFilter` field names `includedAgentIndexes`/`includedIssueIndexes` match `lib/planValidation.ts`.)

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/routes/PlanoRevisao.tsx apps/renderer/src/App.tsx
git commit -m "feat(m16): pedir-algo plain-language plan review page"
```

---

### Task 5: Retire the old form + final verification

**Files:**
- Delete: `apps/renderer/src/routes/GoalNew.tsx`
- Verify: no remaining imports of `GoalNew`.

- [ ] **Step 1: Confirm nothing imports GoalNew**

Run: `git grep -n "GoalNew" -- apps/renderer/src`
Expected: no matches (the App.tsx import was replaced in Task 3). If any match remains, remove it before deleting the file.

- [ ] **Step 2: Delete the file**

```bash
git rm apps/renderer/src/routes/GoalNew.tsx
```

- [ ] **Step 3: Full verification across packages**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all clean; renderer test count up by the Task 1 (6) + Task 2 parity (1) tests; no failures.

- [ ] **Step 4: Manual smoke checklist (packaged or dev)**

  - "Pedir algo" empty state → type a request → "Pedir" → lands in the conversation, CEO replies.
  - "Montar o plano" → "Ver plano" appears → opens the plain-language review page.
  - Deselect one task and one hire → "Aprovar e começar" → lands in Projetos; the approved tasks appear on the project Kanban (gap #2) and any new hires in Minha equipe.
  - "Quero ajustar" returns to the conversation; "Refazer o plano" produces a new plan.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(m16): remove legacy goals form behind pedir algo"
```

---

## Self-Review

**Spec coverage:**
- Conversa real com o CEO → Task 3 (`agents.sendMessage` + `MessageList`/`Composer`). ✓
- Objetivo-primeiro (A1) → Task 3 `start()` creates the goal on the first message. ✓
- Página de revisão dedicada (Opção 2) → Task 4 `PlanoRevisao`. ✓
- Aprovar e começar / Quero ajustar → Task 4 (`approvePlan` / navigate back). ✓
- Reuso do backend de Goal plan → all tasks call `window.prospero.goals.*` unchanged. ✓
- Escopo da conversa → Task 1 `scopeUserMessages` (by `goal.createdAt`). ✓
- Risco do E2E do CEO → Task 3 Step 5 BLOCKING de-risk checkpoint. ✓
- "Nada deletado" (M16) → `GoalDetail`/`/goals/:id` untouched; only the superseded `GoalNew` form is removed. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. The MVP intentionally omits `requestChanges` (the spec's "Quero ajustar" is satisfied by returning to the conversation + "Refazer o plano" = `requestPlan`, which supersedes the proposed plan) and the conversational `formatGoalPlanRequest` variant (not needed — the CEO has the chat in session). Both noted as future enhancements, not gaps.

**Type consistency:** `PlanFilter` fields `includedAgentIndexes`/`includedIssueIndexes` match `GoalPlanReview` usage; `goals.create` uses `CreateGoalInput` (companyId+title required); `approvePlan` opts match the preload signature (`includeAgentIndexes?`, `includeIssueIndexes?`, `mode?`); `Message` has `createdAt` + `threadParticipants?`; CEO found via `role==="ceo" || templateId==="ceo"` (matches `findCeo` + `IssueCommentsList`). `computeFilteredEstimates` returns `{ totalTokens, costCents, durationDays }` (used in `GoalPlanReview`).

**Risk note:** i18next v4 plurals require BOTH `_one` and `_other` suffixes (no bare-key fallback) — keys are `newHires_one`/`newHires_other` and `days_one`/`days_other`, matching the `oauthExpiry` plural precedent. Components call the base name (`t("pedir.plano.days", { count })`); i18next appends the suffix. `noHires` (count 0) is a separate non-plural key chosen explicitly in the component when there are no hires.
