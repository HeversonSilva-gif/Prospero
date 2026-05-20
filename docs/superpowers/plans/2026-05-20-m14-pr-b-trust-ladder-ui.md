# M14 PR-B — Trust Ladder UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the Trust Ladder (built by PR-A's backend) in three UI spots — a tier badge in the agent list (`/agents`) and agent header (`AgentHeader.tsx`); a history panel in the agent detail's Stats tab consuming `trust:get-history`; and a render branch in the Inbox for `trust_promotion_suggested` cards with an "Approve" button that calls `trust:approve-promotion`.

**Architecture:** Renderer-only PR. One small shared util (`tierIconAndLabel`) keyed by `TrustTier` so badge styling stays consistent across surfaces. Each render site is its own commit; nothing shares state beyond the store + the new util. No new IPC, no new store actions — the preload bridge from PR-A is sufficient. UI tokens are real Tailwind tokens; no emojis (project rule — see `feedback_no_emojis`).

**Tech Stack:** TypeScript (strict + `exactOptionalPropertyTypes`), React 18, Tailwind, zustand, react-i18next, vitest. Renderer-only.

**Spec:** `docs/superpowers/specs/2026-05-18-m14-vitrine-confianca-design.md` — §10 (UI), §11 row B (PR-B scope), §4.5 (Run Policy interaction — surfaced as `mode` divergence hint). M14 PR-A merged (HEAD `c930304` at plan time; 1625 tests). PR-B is downstream of A; nothing here ships without A.

**Locked design decisions:**
- **No emojis.** The spec sketch uses `🌱/✓/⚡` for tiers; we'll use short text + an inline SVG dot (color-coded) instead. Project rule, hard.
- **Badge is text + dot, not text + glyph.** A small inline span like `Confiável` with a `bg-semantic-success` 2×2 dot. Three colors total: `novato`=ink-soft, `confiavel`=semantic-success, `autonomo`=brand. Tested taxonomy.
- **History panel goes in the Stats tab** (`apps/renderer/src/components/agent-panel/StatsTab.tsx`), not Config. Rationale: it's a *history view* of past events, not a control. Config stays for write-actions. Decision in spec §15 is left open; PR-B picks Stats.
- **Inbox card has ONE primary action (Aprovar) plus the existing Marcar como lido.** No "Adiar" button — adiar is the same as not approving + marking read. YAGNI.
- **The card preview shows reason text already produced by the backend** (e.g. `Histórico verificado: 15 outcomes · 90% de primeira`). No re-fetch.
- **Live updates:** the store re-fetches `agents.list` on `INBOX_UPDATE` already (existing pattern). PR-A's `recomputeAgentTrust` writes via `agentsRepo.setTrustTier`, which doesn't fire any agent broadcast today. The badge will update on next reload but not live. **Accepted limitation** — adding an agent-changed broadcast is out of scope; flag as PR-D follow-up.
- **i18n:** every visible label has a key in BOTH `en-US.json` and `pt-BR.json`. Parity test enforces.
- **Out of scope for PR-B:** the live-broadcast hook above; the `blockedReason` tooltip ("why not autonomo yet?") — covered in PR-D polish; any Vitrine work — that's PR-C.

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `apps/renderer/src/components/trust/TrustTierBadge.tsx` (+ `.test.tsx`) | One presentational component: `<TrustTierBadge tier="confiavel" />`. Used in agent list and agent header. |
| `apps/renderer/src/components/agent-panel/TrustHistoryPanel.tsx` | Fetches and renders `TrustEvent[]` for an agent. Loading / empty / error states. |
| `apps/renderer/src/components/inbox/TrustPromotionCard.tsx` | Self-contained render branch for `trust_promotion_suggested` inbox items. Has the Aprovar button. |

**Modified files:**

| File | Change |
|------|--------|
| `apps/renderer/src/routes/Agents.tsx` | Append `<TrustTierBadge>` next to `a.role` in the list card. |
| `apps/renderer/src/components/agent-panel/AgentHeader.tsx` | Append `<TrustTierBadge>` next to `agent.role` chip. |
| `apps/renderer/src/components/agent-panel/StatsTab.tsx` | Add a section `<TrustHistoryPanel agentId={agent.id} />` near the bottom. |
| `apps/renderer/src/routes/Inbox.tsx` | Add a render branch that delegates to `<TrustPromotionCard>` when `item.kind === "trust_promotion_suggested"`. |
| `apps/renderer/src/i18n/en-US.json` | Keys under `trust.*` (label per tier + badge title + history empty/loading/error + promotion card title/preview/button/success/error) |
| `apps/renderer/src/i18n/pt-BR.json` | Mirror set (parity test enforces) |

**Why this split:**
- `TrustTierBadge` is a pure presentational component — used in two places, so it lives in `components/trust/` (new dir).
- `TrustHistoryPanel` is per-agent stateful (fetches on mount) — lives next to other agent-panel components.
- `TrustPromotionCard` keeps the Inbox switch lean — the existing file already has multiple render branches inline; adding the trust render directly would push `Inbox.tsx` past 300 LOC. Extracting to a component is the right call.

---

## Task 1: `TrustTierBadge` component

**Files:**
- Create: `apps/renderer/src/components/trust/TrustTierBadge.tsx`
- Create: `apps/renderer/src/components/trust/TrustTierBadge.test.tsx`

> Read `apps/renderer/src/components/agent-panel/AgentHeader.tsx:51-67` for the existing badge idiom (small text chip on `bg-surface-soft`). Match the height/font-size. No emojis (`feedback_no_emojis` memory). Use `@testing-library/react` — the renderer already uses it (grep `from "@testing-library/react"` to confirm).

- [ ] **Step 1: Write the failing test**

Create `apps/renderer/src/components/trust/TrustTierBadge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "../../i18n/en-US.json";
import { TrustTierBadge } from "./TrustTierBadge.js";

void i18n.use(initReactI18next).init({
  lng: "en-US",
  resources: { "en-US": { translation: enUS } },
  interpolation: { escapeValue: false },
});

const renderBadge = (tier: "novato" | "confiavel" | "autonomo") =>
  render(
    <I18nextProvider i18n={i18n}>
      <TrustTierBadge tier={tier} />
    </I18nextProvider>,
  );

describe("TrustTierBadge", () => {
  it("renders the label for novato", () => {
    const { getByText } = renderBadge("novato");
    expect(getByText(/novice/i)).toBeTruthy();
  });

  it("renders the label for confiavel", () => {
    const { getByText } = renderBadge("confiavel");
    expect(getByText(/trusted/i)).toBeTruthy();
  });

  it("renders the label for autonomo", () => {
    const { getByText } = renderBadge("autonomo");
    expect(getByText(/autonomous/i)).toBeTruthy();
  });

  it("includes a status dot element", () => {
    const { container } = renderBadge("confiavel");
    // The dot is a 2x2 span; assert its presence by class.
    const dot = container.querySelector(".rounded-full");
    expect(dot).not.toBeNull();
  });
});
```

Run: `pnpm --filter @prospero/renderer test TrustTierBadge`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Write the implementation**

Create `apps/renderer/src/components/trust/TrustTierBadge.tsx`:

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { TrustTier } from "@prospero/shared";

// M14 PR-B — Trust tier badge. Small text chip + color dot. Used in the
// agent list card and the agent header. NO emojis (project rule
// `feedback_no_emojis`); tier semantics encoded via dot color + text.

const TIER_DOT: Record<TrustTier, string> = {
  novato: "bg-ink-soft",
  confiavel: "bg-semantic-success",
  autonomo: "bg-brand",
};

interface Props {
  tier: TrustTier;
}

export const TrustTierBadge: FC<Props> = ({ tier }) => {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted"
      title={t(`trust.badge.title.${tier}`)}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT[tier]}`} aria-hidden />
      {t(`trust.tier.${tier}`)}
    </span>
  );
};
```

- [ ] **Step 3: Add the i18n keys**

In `apps/renderer/src/i18n/en-US.json`, add (merge into existing root JSON; mirror the existing namespacing style by adding a top-level `trust` key):

```json
"trust": {
  "tier": {
    "novato": "Novice",
    "confiavel": "Trusted",
    "autonomo": "Autonomous"
  },
  "badge": {
    "title": {
      "novato": "Novice — gate asks about sensitive actions",
      "confiavel": "Trusted — read-only tools auto-approved",
      "autonomo": "Autonomous — running in auto mode"
    }
  }
}
```

In `apps/renderer/src/i18n/pt-BR.json`, mirror with the same key paths:

```json
"trust": {
  "tier": {
    "novato": "Novato",
    "confiavel": "Confiável",
    "autonomo": "Autônomo"
  },
  "badge": {
    "title": {
      "novato": "Novato — o gate pergunta antes de ações sensíveis",
      "confiavel": "Confiável — ferramentas read-only são auto-aprovadas",
      "autonomo": "Autônomo — rodando em modo auto"
    }
  }
}
```

(The test in Step 1 asserts the English labels; if you change them, update the regexes accordingly.)

- [ ] **Step 4: Run tests + parity**

Run: `pnpm --filter @prospero/renderer test TrustTierBadge`
Expected: PASS — 4 cases.
Run: `pnpm --filter @prospero/renderer test parity`
Expected: PASS — EN/PT key sets identical.
Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/components/trust apps/renderer/src/i18n
git commit -m "feat(trust): add TrustTierBadge presentational component"
```

---

## Task 2: Badge in the agent list (`Agents.tsx`)

**Files:**
- Modify: `apps/renderer/src/routes/Agents.tsx`

> Read `apps/renderer/src/routes/Agents.tsx:53-60` to see where `a.role` is rendered. The badge goes right after the role line, on its own line, so the existing two-line layout (name + role) becomes three lines (name + role + tier).

- [ ] **Step 1: Add the import**

Near the top of `Agents.tsx`, add:

```typescript
import { TrustTierBadge } from "../components/trust/TrustTierBadge.js";
```

- [ ] **Step 2: Render the badge under the role**

Locate the `<div className="text-xs text-ink-muted">{a.role}</div>` line. Replace with:

```tsx
<div className="text-xs text-ink-muted">{a.role}</div>
<div className="mt-1">
  <TrustTierBadge tier={a.trustTier} />
</div>
```

- [ ] **Step 3: Run renderer tests + typecheck**

Run: `pnpm --filter @prospero/renderer test`
Expected: PASS — 168 tests still green (no test in `routes/Agents.tsx`'s area asserts layout; the badge is additive).
Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/routes/Agents.tsx
git commit -m "feat(trust): show trust tier badge in the agent list"
```

---

## Task 3: Badge in the agent header

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/AgentHeader.tsx`

> Read `apps/renderer/src/components/agent-panel/AgentHeader.tsx:56-60` for the role chip. The trust badge sits right after it, with the same gap rhythm.

- [ ] **Step 1: Add the import**

Near the top of `AgentHeader.tsx`, add:

```typescript
import { TrustTierBadge } from "../trust/TrustTierBadge.js";
```

- [ ] **Step 2: Add the badge after the role chip**

Locate this block (around line 56-59):

```tsx
<span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
  {agent.role}
</span>
```

Add immediately after:

```tsx
<TrustTierBadge tier={agent.trustTier} />
```

- [ ] **Step 3: Run renderer typecheck + tests**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/renderer test`
Expected: 168 still green.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/agent-panel/AgentHeader.tsx
git commit -m "feat(trust): show trust tier badge in the agent header"
```

---

## Task 4: `TrustHistoryPanel` component

**Files:**
- Create: `apps/renderer/src/components/agent-panel/TrustHistoryPanel.tsx`

> Read `apps/renderer/src/components/agent-panel/StatsTab.tsx` to see the existing section idiom (likely uses `Section` from `components/ui/`). Read `apps/renderer/src/components/ui/index.ts` to confirm `Section` / `EmptyState` / `LoadingState` primitives. Look at how M13 PR-E's `SecurityZonesPanel` does the load (`apps/renderer/src/components/settings/SecurityZonesPanel.tsx:14-22`) — same idiom: `useEffect` + `useState` + 3 explicit states.

- [ ] **Step 1: Write the component**

Create `apps/renderer/src/components/agent-panel/TrustHistoryPanel.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { TrustEvent, TrustEventKind, TrustTier } from "@prospero/shared";

// M14 PR-B — read-only history of the agent's trust ladder transitions.
// Consumes window.prospero.trust.getHistory({agentId}); loading / empty /
// error states are explicit. The list is already returned in
// reverse-chronological order (TrustEventsRepository ORDER BY created_at DESC,
// rowid DESC — M14 PR-A).

const KIND_DOT: Record<TrustEventKind, string> = {
  promoted: "bg-semantic-success",
  demoted: "bg-semantic-danger",
  promotion_suggested: "bg-brand",
};

interface Props {
  agentId: string;
}

export const TrustHistoryPanel: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const [events, setEvents] = useState<TrustEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.prospero.trust.getHistory({ agentId });
        setEvents(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [agentId]);

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("trust.history.title")}
      </h2>
      <p className="text-xs text-ink-muted mb-3">{t("trust.history.subtitle")}</p>

      {error !== null && (
        <p role="alert" className="text-xs text-semantic-danger">
          {error}
        </p>
      )}
      {error === null && events === null && (
        <p className="text-xs text-ink-muted">{t("trust.history.loading")}</p>
      )}
      {error === null && events !== null && events.length === 0 && (
        <p className="text-xs text-ink-muted">{t("trust.history.empty")}</p>
      )}
      {error === null && events !== null && events.length > 0 && (
        <ul className="space-y-2 text-xs">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-start gap-2 border-t border-surface-border pt-2 first:border-t-0 first:pt-0"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${KIND_DOT[e.kind]}`}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className="text-ink">
                  <span className="font-semibold">
                    {t(`trust.history.kind.${e.kind}`)}
                  </span>
                  {": "}
                  <span className="text-ink-muted">
                    {t(`trust.tier.${e.fromTier as TrustTier}`)} →{" "}
                    {t(`trust.tier.${e.toTier as TrustTier}`)}
                  </span>
                </p>
                <p className="text-ink-muted break-words">{e.reason}</p>
              </div>
              <span className="text-[10px] text-ink-soft shrink-0">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
```

- [ ] **Step 2: Extend the i18n keys (merge into the `trust` namespace from Task 1)**

In `apps/renderer/src/i18n/en-US.json`, expand the `trust` block:

```json
"trust": {
  "tier": { ...as before... },
  "badge": { ...as before... },
  "history": {
    "title": "Trust history",
    "subtitle": "Automatic promotions, demotions, and suggested promotions for this agent.",
    "loading": "Loading history…",
    "empty": "No trust events yet — this agent is fresh.",
    "kind": {
      "promoted": "Promoted",
      "demoted": "Demoted",
      "promotion_suggested": "Promotion suggested"
    }
  }
}
```

In `apps/renderer/src/i18n/pt-BR.json`, mirror:

```json
"trust": {
  "tier": { ...as before... },
  "badge": { ...as before... },
  "history": {
    "title": "Histórico de confiança",
    "subtitle": "Promoções automáticas, rebaixamentos e sugestões pra este agente.",
    "loading": "Carregando histórico…",
    "empty": "Nenhum evento de confiança ainda — agente novato.",
    "kind": {
      "promoted": "Promovido",
      "demoted": "Rebaixado",
      "promotion_suggested": "Promoção sugerida"
    }
  }
}
```

- [ ] **Step 3: Run typecheck + parity**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/renderer test parity`
Expected: 20 cases pass.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/agent-panel/TrustHistoryPanel.tsx apps/renderer/src/i18n
git commit -m "feat(trust): add TrustHistoryPanel that lists trust events"
```

---

## Task 5: Slot `TrustHistoryPanel` into the Stats tab

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/StatsTab.tsx`

> Read `apps/renderer/src/components/agent-panel/StatsTab.tsx` end-to-end. The Stats tab today shows turns / tokens / cost from `agents:stats`. The trust history panel slots **at the bottom** of the tab — after the existing budget/cost sections.

- [ ] **Step 1: Add the import**

Near the top of `StatsTab.tsx`, add:

```typescript
import { TrustHistoryPanel } from "./TrustHistoryPanel.js";
```

- [ ] **Step 2: Render the panel at the bottom of the existing layout**

Find the outermost return JSX of the tab. Right before the final closing `</div>` (or `</section>`, whatever wraps the tab content), insert:

```tsx
<TrustHistoryPanel agentId={agent.id} />
```

(The `agent` prop is already in scope — the tab receives it from the parent. If the prop name is different, mirror what the file already uses.)

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/renderer test`
Expected: 168 still green.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/agent-panel/StatsTab.tsx
git commit -m "feat(trust): slot trust history into the agent stats tab"
```

---

## Task 6: `TrustPromotionCard` component

**Files:**
- Create: `apps/renderer/src/components/inbox/TrustPromotionCard.tsx`

> Read `apps/renderer/src/routes/Inbox.tsx:111-200` to see how other kind-specific render branches look. The card extracts logic that would otherwise bloat the Inbox switch. It receives the `InboxItem` and a `markRead` callback (also used by the existing branches).

- [ ] **Step 1: Write the component**

Create `apps/renderer/src/components/inbox/TrustPromotionCard.tsx`:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { InboxItem } from "@prospero/shared";

// M14 PR-B — render branch for `trust_promotion_suggested` inbox items.
// Backend (engine.ts) already wrote the title + preview text in Portuguese
// at creation time (e.g. "Promover X para Autônomo?"); we surface the
// Aprovar button that calls trust:approve-promotion.

interface Props {
  item: InboxItem;
  markRead: (id: string) => void;
}

export const TrustPromotionCard: FC<Props> = ({ item, markRead }) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async (): Promise<void> => {
    setError(null);
    setPending(true);
    try {
      await window.prospero.trust.approvePromotion({ inboxItemId: item.id });
      // Backend marks read + broadcasts — but reflect in the local store
      // immediately so the user sees instant feedback.
      markRead(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  if (item.readAt !== null) {
    // Already resolved — nothing to do.
    return null;
  }

  return (
    <div className="flex gap-2 mt-2">
      <button
        type="button"
        onClick={() => void approve()}
        disabled={pending}
        className="text-xs px-3 py-1 bg-semantic-success text-white rounded font-semibold disabled:opacity-50"
      >
        {pending ? t("trust.promotionCard.approving") : t("trust.promotionCard.approve")}
      </button>
      {error !== null && (
        <span role="alert" className="text-xs text-semantic-danger self-center">
          {error}
        </span>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Extend the i18n keys**

In `apps/renderer/src/i18n/en-US.json`, expand `trust`:

```json
"trust": {
  ... existing ...,
  "promotionCard": {
    "approve": "Approve promotion",
    "approving": "Approving…"
  }
}
```

In `apps/renderer/src/i18n/pt-BR.json`:

```json
"trust": {
  ... existing ...,
  "promotionCard": {
    "approve": "Aprovar promoção",
    "approving": "Aprovando…"
  }
}
```

- [ ] **Step 3: Run typecheck + parity**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/renderer test parity`
Expected: 20 cases pass.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/inbox/TrustPromotionCard.tsx apps/renderer/src/i18n
git commit -m "feat(trust): add TrustPromotionCard for inbox approval"
```

---

## Task 7: Render the trust card in the Inbox

**Files:**
- Modify: `apps/renderer/src/routes/Inbox.tsx`

> Read `apps/renderer/src/routes/Inbox.tsx` end-to-end. The Inbox renders items in a list with kind-specific branches inside the `<li>`. The trust card is one more branch.

- [ ] **Step 1: Add the import**

Near the top of `Inbox.tsx`, add:

```typescript
import { TrustPromotionCard } from "../components/inbox/TrustPromotionCard.js";
```

- [ ] **Step 2: Add the render branch**

Locate the place inside the `.map((item) => ...)` block where the existing kind-specific renders sit (right after the `approval` block, before the `GOAL_KINDS.includes` block). Add:

```tsx
{item.kind === "trust_promotion_suggested" && (
  <TrustPromotionCard item={item} markRead={markRead} />
)}
```

(Confirm `markRead` is the local function the existing render branches use. If it's called `onMarkRead` or `resolveRead`, adapt.)

- [ ] **Step 3: Run renderer test + typecheck**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.
Run: `pnpm --filter @prospero/renderer test`
Expected: 168 still green.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/routes/Inbox.tsx
git commit -m "feat(trust): render trust_promotion_suggested in the inbox"
```

---

## Task 8: Full verification + non-regression

**Files:** none (verification only).

- [ ] **Step 1: Whole-monorepo typecheck**

Run: `pnpm typecheck`
Expected: clean across all 4 packages.

- [ ] **Step 2: Whole-monorepo lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Renderer test suite**

Run: `pnpm --filter @prospero/renderer test`
Expected: green. Baseline is 168; PR-B adds:
- TrustTierBadge: 4 cases

Expected delta: **+4 tests**, renderer total ~**172**. Note the actual final number for the handoff.

- [ ] **Step 4: Whole-monorepo test**

Run: `pnpm test`
Expected: all 4 packages green. Total: ~**1629** + 2 todo (1625 baseline + 4 new tests). Note actual.

- [ ] **Step 5: Token efficiency confirmation**

PR-B is renderer-only — zero touch on `apps/main/src/orchestrator/`. Confirm:

```
grep -rn "TrustTierBadge\|TrustHistoryPanel\|TrustPromotionCard\|trust:get-history\|trust:approve-promotion" apps/main/src/
```

Expected: empty (the renderer's preload bridge stays, but no main-process code references the renderer components or invokes the IPCs from the main side — they're outbound only).

- [ ] **Step 6: Manual smoke (PENDING — list for the human)**

The Electron app cannot run from the agent's environment. In the final commit message or PR description, list these PENDING steps:

1. Launch the app. Open `/agents`. Confirm each agent card shows a tier badge under its role.
2. Open `/agents/<id>`. Confirm the badge appears in the header next to the role chip.
3. Open the Stats tab. Confirm a "Trust history" section renders (empty for a fresh agent).
4. Simulate a trust event (in dev: insert manually via better-sqlite3 console or wait for the engine to fire). Reload. Confirm the event appears in the panel.
5. Trigger a `confiavel→autonomo` suggestion (15 verified outcomes + 0.9 pass rate). Open the Inbox. Confirm a `trust_promotion_suggested` card appears with the Aprovar button. Click. Confirm the agent flips to autonomo + `mode='auto'` (visible in Config) and the card resolves.

- [ ] **Step 7: Optional cleanup commit (only if Step 1 or 2 surfaced fixes)**

If a count assertion or type literal needed touching:

```bash
git add -A
git commit -m "test(trust): update count assertions"
```

Otherwise skip.

---

## Self-Review (completed by plan author)

**Spec coverage (§10 + §11 row B):**

- §10 row "Lista de agentes": badge of tier in each agent → Task 2 ✓
- §10 row "Agent detail": badge of `trust_tier` in the header → Task 3 ✓
- §10 row "Agent detail": painel de histórico de confiança (`trust_events`) → Tasks 4 + 5 ✓
- §10 row "Inbox": card novo `trust_promotion_suggested` com CTA Aprovar → Tasks 6 + 7 ✓
- §10 row "Agent detail": the `blockedReason` ("por que não sobe") tooltip → **deferred to PR-D** (out of scope, flagged in locked decisions)
- §11 row B (full PR-B scope) → covered ✓

**Placeholder scan:** every code step shows code. Three flagged adapt-points: Task 5 Step 2 (confirm `agent` prop name in `StatsTab.tsx` — it might be `agentId` or `currentAgent`), Task 7 Step 2 (confirm `markRead` function name in `Inbox.tsx` — could differ), and Task 4 Step 1's reuse of `Section`/`LoadingState`/`EmptyState` primitives (use them if they exist; the plain `<section>` shown still works). All three are "find this; mirror it", not "TBD".

**Type consistency:** `TrustTier` and `TrustEvent` from `@prospero/shared` are used in Tasks 1, 4, 6 with identical names. `KIND_DOT: Record<TrustEventKind, string>` in Task 4 uses the 3 kinds defined in PR-A. The `<TrustTierBadge tier={...} />` interface is fixed in Task 1 and consumed identically in Tasks 2 + 3. The `<TrustPromotionCard item markRead />` interface is fixed in Task 6 and consumed identically in Task 7.

**i18n parity:** every visible label has the same key path in both `en-US.json` and `pt-BR.json` (Tasks 1, 4, 6 all add to the `trust` namespace symmetrically). Parity test enforces.

**Token efficiency:** renderer-only PR; zero touch on agent system prompts (Task 8 Step 5 verifies). The `trust:*` IPCs are renderer→main calls only; main does not push any new data into agent prompts.

**Security:** no new security paths. The Aprovar button calls an existing IPC (`trust:approve-promotion`) which is already audited backend-side (writes `trust_event 'promoted'` + `activity_event 'trust.promoted'`). User intent is captured by the click + the existing per-window auth.
