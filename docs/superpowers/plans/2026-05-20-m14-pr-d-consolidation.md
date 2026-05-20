# M14 PR-D — Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close M14 by knocking down seven follow-ups from PR-A/B/C plus spec §11 row D: live broadcast of trust tier changes; `blockedReason` tooltip on the tier badge (via a new read-only IPC); live refresh of the Vitrine via `INBOX_UPDATE`; UI polish of the briefing page; `SECURITY.md` (Trust ladder + Morning briefing sections); `roadmap.html` refresh; non-regression audit.

**Architecture:** Six independent commits in `main`, all additive. Reuses the existing `IPC.AGENT_EVENT` channel for the new `trust-tier-changed` variant. Adds one read-only IPC `trust:get-evaluation` (compute-on-demand — no new persisted state). Vitrine subscribes to `INBOX_UPDATE` via the preload hook already used by `useInboxStore`. No migrations.

**Tech Stack:** TypeScript (strict + `exactOptionalPropertyTypes`), Electron, better-sqlite3, React 18, Tailwind, zustand, react-i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-05-20-m14-pr-d-consolidation-design.md`. M14 PR-A + PR-B + PR-C merged (HEAD `1cb1f77` at plan time; 1641 tests).

**Locked design decisions:**
- **Bundled PR in `main`** — same pattern as M13 PR-F / M14 PR-A/B/C.
- **No new migrations.** All changes are additive code + docs.
- **`blockedReason` is compute-on-demand**, not a stored column. Spec §3.2 picked Approach B (new IPC). Mantém o invariante "score não é estado armazenado" do PR-A.
- **Reuse `IPC.AGENT_EVENT`** — `AgentEvent` union ganha mais um variant; sem canal novo.
- **Reuse `window.prospero.inbox.onUpdate`** pra Vitrine live refresh — sem canal novo.
- **`frontend-design` skill é consultada** no Task 4, mas o cap é hard (200 LOC). Se a proposta exceder, trim antes de commitar.
- **Out of scope:** smoke manual; smoke do `claude -p` headless; OS notifications; fusão Dashboard ↔ Vitrine; hardening do `criterion_judge`; materializar `blockedReason` no banco.

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `apps/main/src/ipc/agent-event-broadcast.ts` (+ optional test) | `broadcastAgentEvent(event)` helper — mirrors `broadcastInboxUpdate` from M13 PR-F. Loops `BrowserWindow.getAllWindows()`. |

**Modified files:**

| File | Change | Task |
|------|--------|------|
| `packages/shared/src/types/message.ts` | `AgentEvent` += `{ kind: "trust-tier-changed"; agentId; tier }` | 1 |
| `apps/main/src/agents/repository.ts` | `setTrustTier(id, tier)` broadcasts the new event | 1 |
| `apps/main/src/agents/repository.test.ts` | +1 case: broadcast fires | 1 |
| `apps/renderer/src/stores/agents.ts` | New action `applyTrustTier(agentId, tier)` | 1 |
| `apps/renderer/src/stores/agents.delta-handlers.test.ts` | +1 case for `applyTrustTier` | 1 |
| `apps/renderer/src/App.tsx` | Add `case "trust-tier-changed"` to the agent-event switch | 1 |
| `packages/shared/src/ipc-channels.ts` | `TRUST_GET_EVALUATION: "trust:get-evaluation"` | 2 |
| `apps/main/src/ipc/trust-handlers.ts` | `getEvaluation({ agentId })` + register | 2 |
| `apps/main/tests/trust-handlers.test.ts` | +1 case for `getEvaluation` | 2 |
| `apps/main/src/ipc/preload.ts` | `trust.getEvaluation` exposed | 2 |
| `apps/renderer/src/env.d.ts` | Mirror | 2 |
| `apps/renderer/src/components/trust/TrustTierBadge.tsx` | Lazy fetch on `onMouseEnter`; tooltip falls back to `t()` | 2 |
| `apps/renderer/src/i18n/{en-US,pt-BR}.json` | `trust.badge.blockedPrefix` key | 2 |
| `apps/renderer/src/stores/briefing.ts` | New action `subscribeInbox(companyId): () => void` | 3 |
| `apps/renderer/src/routes/Briefing.tsx` | `useEffect(() => subscribeInbox(...), [activeCompanyId])` | 3 |
| `apps/renderer/src/routes/Briefing.tsx` | Polish — bucket dots, contrast, rhythm (cap 200 LOC) | 4 |
| `SECURITY.md` | Two new sections (Trust ladder + Morning briefing) | 5 |
| `docs/roadmap.html` | Refresh /00 + /03 + fix "agente→funcionário" | 6 |

---

## Task 1: Live broadcast do tier change

**Files:**
- Create: `apps/main/src/ipc/agent-event-broadcast.ts`
- Modify: `packages/shared/src/types/message.ts`
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/src/agents/repository.test.ts`
- Modify: `apps/renderer/src/stores/agents.ts`
- Modify: `apps/renderer/src/stores/agents.delta-handlers.test.ts`
- Modify: `apps/renderer/src/App.tsx`

> Read `apps/main/src/ipc/orchestrator-handlers.ts:67-71` for the existing `broadcast(event)` helper idiom. Read `apps/main/src/ipc/inbox-handlers.ts` for the `broadcastInboxUpdate` exported helper pattern (M13 PR-F). Mirror the latter. Read `apps/renderer/src/App.tsx:288-314` for the existing event switch — adding a new variant is one new case, no exhaustive-default refactor needed (the switch is non-exhaustive by design; cases `tool-call`, `error`, `costs-new`, `rate-limited` already fall through).

- [ ] **Step 1: Add the `trust-tier-changed` variant to `AgentEvent`**

In `packages/shared/src/types/message.ts`, locate the `AgentEvent` union (line ~35). Add at the end (before the closing `;`):

```typescript
  | { kind: "trust-tier-changed"; agentId: string; tier: TrustTier }
```

Add `TrustTier` to the imports at the top of the file:

```typescript
import type { TrustTier } from "./trust.js";
```

(Confirm the file already imports `Message`, `AgentStatus`, `ToolCallView` — add `TrustTier` alongside; if the file uses `import type { ... } from "./xxx.js"`, mirror.)

- [ ] **Step 2: Create the broadcast helper**

Create `apps/main/src/ipc/agent-event-broadcast.ts`:

```typescript
import { BrowserWindow } from "electron";
import { IPC, type AgentEvent } from "@prospero/shared";

// M14 PR-D — shared helper for fan-out of AgentEvent to all renderer windows.
// Mirrors `broadcastInboxUpdate` (M13 PR-F). Imported by repos that mutate
// agent state but don't otherwise pull in the orchestrator handler module.

export const broadcastAgentEvent = (event: AgentEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, event);
  }
};
```

- [ ] **Step 3: Write the failing test for `setTrustTier` broadcast**

In `apps/main/src/agents/repository.test.ts`, add (mock `electron` at top of file if not already mocked; mirror how `tests/security.gate-zones.test.ts` does `vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }))` from M13 PR-F).

```typescript
import { vi } from "vitest";

vi.mock("electron", () => {
  const sendSpy = vi.fn();
  return {
    BrowserWindow: {
      getAllWindows: () => [{ webContents: { send: sendSpy } }],
    },
    __sendSpy: sendSpy,
  };
});

import * as electron from "electron";
const sendSpy = (electron as unknown as { __sendSpy: ReturnType<typeof vi.fn> }).__sendSpy;
```

(Adapt to the file's existing vi.mock idiom; if no electron mock exists yet, add the one above near the top of the file.)

Add the test inside the existing describe block:

```typescript
describe("trust tier broadcast (M14 PR-D)", () => {
  it("setTrustTier fires AGENT_EVENT with trust-tier-changed", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    sendSpy.mockClear();
    repo.setTrustTier(a.id, "confiavel");
    expect(sendSpy).toHaveBeenCalledWith(
      "agent:event",
      expect.objectContaining({
        kind: "trust-tier-changed",
        agentId: a.id,
        tier: "confiavel",
      }),
    );
  });
});
```

Run: `pnpm --filter @prospero/main test "agents/repository"`
Expected: FAIL — `setTrustTier` doesn't broadcast yet.

- [ ] **Step 4: Wire the broadcast into `setTrustTier`**

In `apps/main/src/agents/repository.ts`, find the `setTrustTier` implementation. Add the broadcast call after the UPDATE:

```typescript
import { broadcastAgentEvent } from "../ipc/agent-event-broadcast.js";
// ...
setTrustTier(id, tier) {
  db.prepare("UPDATE agents SET trust_tier = ?, updated_at = ? WHERE id = ?").run(
    tier,
    Date.now(),
    id,
  );
  try {
    broadcastAgentEvent({ kind: "trust-tier-changed", agentId: id, tier });
  } catch (err) {
    // Defensive: broadcast failure must never break the tier write.
    console.warn("[trust] broadcastAgentEvent failed", err);
  }
},
```

(If `setTrustTier` already had a comment about leaving audit to the engine, keep that comment.)

- [ ] **Step 5: Add the renderer store action**

In `apps/renderer/src/stores/agents.ts`, add to the interface (line ~8-10):

```typescript
applyTrustTier: (agentId: string, tier: TrustTier) => void;
```

Add `TrustTier` to the imports at the top:

```typescript
import type { AgentStatus, TrustTier } from "@prospero/shared";
```

(Adapt to the existing imports — the file likely already imports several types from `@prospero/shared`.)

Add the implementation alongside the other `apply*` actions (mirror `applyAgentStatus`):

```typescript
applyTrustTier: (agentId, tier) =>
  set((s) => ({
    agents: s.agents.map((a) => (a.id === agentId ? { ...a, trustTier: tier } : a)),
  })),
```

- [ ] **Step 6: Write the failing test for `applyTrustTier`**

In `apps/renderer/src/stores/agents.delta-handlers.test.ts`, add (mirror existing `applyAgentStatus` test):

```typescript
it("applyTrustTier updates the agent's trustTier without touching other fields", () => {
  useAgentsStore.setState({ agents: [/* fixture agent with trustTier 'novato' */] });
  useAgentsStore.getState().applyTrustTier("agent_1", "confiavel");
  const a = useAgentsStore.getState().agents.find((x) => x.id === "agent_1");
  expect(a?.trustTier).toBe("confiavel");
});

it("applyTrustTier is a no-op for an unknown agent", () => {
  useAgentsStore.setState({ agents: [/* fixture */] });
  useAgentsStore.getState().applyTrustTier("agent_unknown", "confiavel");
  // No throw, no change.
});
```

(Adapt the fixture shape to the existing test file's helpers.)

Run: `pnpm --filter @prospero/renderer test "agents.delta-handlers"`
Expected: PASS (the action was added in Step 5; the test asserts the behavior).

- [ ] **Step 7: Wire the case in `App.tsx`**

In `apps/renderer/src/App.tsx` around line 296 (the existing switch in the `agents.onEvent` subscriber), add a new case:

```tsx
case "trust-tier-changed":
  applyTrustTier(ev.agentId, ev.tier);
  break;
```

Then add `applyTrustTier` to the destructured store actions at the top of the `App` component (mirror line 244):

```typescript
const applyTrustTier = useAgentsStore((s) => s.applyTrustTier);
```

And add it to the deps array of the `useEffect` (mirror line 319).

- [ ] **Step 8: Typecheck + tests**

Run: `pnpm --filter @prospero/main typecheck`
Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/main test "agents/repository"`
Run: `pnpm --filter @prospero/renderer test "agents.delta-handlers"`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/types/message.ts apps/main/src/ipc/agent-event-broadcast.ts apps/main/src/agents/repository.ts apps/main/src/agents/repository.test.ts apps/renderer/src/stores/agents.ts apps/renderer/src/stores/agents.delta-handlers.test.ts apps/renderer/src/App.tsx
git commit -m "feat(trust): broadcast agent change on tier mutation"
```

---

## Task 2: `blockedReason` tooltip via `trust:get-evaluation`

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `apps/main/src/ipc/trust-handlers.ts`
- Modify: `apps/main/tests/trust-handlers.test.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`
- Modify: `apps/renderer/src/components/trust/TrustTierBadge.tsx`
- Modify: `apps/renderer/src/i18n/en-US.json` + `pt-BR.json`

> Read `apps/main/src/ipc/trust-handlers.ts` for the existing `trustHandlers(deps)` factory + `getHistory` / `approvePromotion` methods. Read `apps/main/src/trust/evaluate.ts` and `apps/main/src/trust/track-record.ts` — both already export the functions; the handler just stitches them. Read `apps/renderer/src/components/trust/TrustTierBadge.tsx` (M14 PR-B) to see the current tooltip — the new behavior lazy-fetches the reason on `onMouseEnter`.

- [ ] **Step 1: Add the IPC channel**

In `packages/shared/src/ipc-channels.ts`, append before the closing `} as const`:

```typescript
TRUST_GET_EVALUATION: "trust:get-evaluation",
```

- [ ] **Step 2: Extend the trust handler**

In `apps/main/src/ipc/trust-handlers.ts`:

1. Add imports at the top:

```typescript
import { createAgentsRepository } from "../agents/repository.js";
import { collectTrackRecord } from "../trust/track-record.js";
import { evaluateTier } from "../trust/evaluate.js";
import type { TierEvaluation } from "@prospero/shared";
```

(Confirm if `createAgentsRepository` is already imported — adjust accordingly.)

2. Add to the `TrustHandlers` interface:

```typescript
getEvaluation(args: { agentId: string }): TierEvaluation;
```

3. Add the implementation inside `trustHandlers`:

```typescript
getEvaluation({ agentId }) {
  const agentsRepo = createAgentsRepository(deps.db, recorder);
  const agent = agentsRepo.getById(agentId);
  if (agent === null) {
    return { current: "novato", eligible: "novato", blockedReason: null };
  }
  const record = collectTrackRecord(deps.db, agentId);
  return evaluateTier(record, agent.trustTier);
},
```

(Reuse the existing `recorder` const that the handler already creates for `agentsRepo`. If the file's existing methods use a different repo-construction pattern, mirror it.)

4. Register the IPC:

```typescript
ipcMain.handle(IPC.TRUST_GET_EVALUATION, (_e, args: { agentId: string }) =>
  h.getEvaluation(args),
);
```

- [ ] **Step 3: Write the handler test**

In `apps/main/tests/trust-handlers.test.ts`, add:

```typescript
it("getEvaluation returns the current + eligible + blockedReason for an agent", () => {
  const { h } = setup();
  // Agent is at 'confiavel' (set up via setup()). With no verified outcomes
  // beyond the seed, eligible drops back to 'novato' (no failures means
  // eligible 'confiavel' requires CONFIAVEL_MIN_OUTCOMES verified outcomes,
  // which the fresh setup has 0 of).
  const ev = h.getEvaluation({ agentId: "a1" });
  expect(ev.current).toBe("confiavel");
  expect(ev.eligible).toBe("novato");
});

it("getEvaluation returns a no-op for a missing agent", () => {
  const { h } = setup();
  const ev = h.getEvaluation({ agentId: "missing" });
  expect(ev.current).toBe("novato");
  expect(ev.eligible).toBe("novato");
  expect(ev.blockedReason).toBeNull();
});
```

Run: `pnpm --filter @prospero/main test "trust-handlers"`
Expected: PASS — 2 new cases plus the existing 4.

- [ ] **Step 4: Expose on the preload bridge**

In `apps/main/src/ipc/preload.ts`, add `TierEvaluation` to the imports from `@prospero/shared`, then extend the `trust` namespace:

```typescript
trust: {
  getHistory: ...,
  approvePromotion: ...,
  getEvaluation: (args: { agentId: string }) =>
    ipcRenderer.invoke(IPC.TRUST_GET_EVALUATION, args) as Promise<TierEvaluation>,
},
```

In `apps/renderer/src/env.d.ts`, add `TierEvaluation` to imports and mirror the namespace:

```typescript
trust: {
  getHistory: (args: { agentId: string }) => Promise<TrustEvent[]>;
  approvePromotion: (args: { inboxItemId: string }) => Promise<{ ok: true }>;
  getEvaluation: (args: { agentId: string }) => Promise<TierEvaluation>;
};
```

- [ ] **Step 5: Add the i18n keys**

In `apps/renderer/src/i18n/en-US.json`, extend the `trust.badge` namespace:

```json
"badge": {
  "title": { /* existing */ },
  "blockedPrefix": "Why not higher: {{reason}}"
}
```

In `apps/renderer/src/i18n/pt-BR.json`:

```json
"badge": {
  "title": { /* existing */ },
  "blockedPrefix": "Por que não sobe: {{reason}}"
}
```

- [ ] **Step 6: Update `TrustTierBadge.tsx` to fetch on hover**

In `apps/renderer/src/components/trust/TrustTierBadge.tsx`, modify the component to lazy-fetch the evaluation:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { TrustTier } from "@prospero/shared";

const TIER_DOT: Record<TrustTier, string> = {
  novato: "bg-ink-soft",
  confiavel: "bg-semantic-success",
  autonomo: "bg-brand",
};

interface Props {
  tier: TrustTier;
  agentId?: string;
}

export const TrustTierBadge: FC<Props> = ({ tier, agentId }) => {
  const { t } = useTranslation();
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const onHover = (): void => {
    if (fetched || agentId === undefined) return;
    setFetched(true);
    void window.prospero.trust.getEvaluation({ agentId }).then((ev) => {
      if (ev.blockedReason !== null) setBlockedReason(ev.blockedReason);
    });
  };

  const titleText =
    blockedReason !== null
      ? t("trust.badge.blockedPrefix", { reason: blockedReason })
      : t(`trust.badge.title.${tier}`);

  return (
    <span
      onMouseEnter={onHover}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted"
      title={titleText}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT[tier]}`} aria-hidden />
      {t(`trust.tier.${tier}`)}
    </span>
  );
};
```

- [ ] **Step 7: Pass `agentId` from the call sites**

Two call sites use `<TrustTierBadge tier={...} />`:
- `apps/renderer/src/routes/Agents.tsx` (list card)
- `apps/renderer/src/components/agent-panel/AgentHeader.tsx` (header)

In both, change `<TrustTierBadge tier={a.trustTier} />` (or `agent.trustTier`) to add the agentId:

```tsx
<TrustTierBadge tier={a.trustTier} agentId={a.id} />
<TrustTierBadge tier={agent.trustTier} agentId={agent.id} />
```

(Confirm the variable name in each site — `a` vs. `agent`.)

- [ ] **Step 8: Typecheck + parity**

Run: `pnpm --filter @prospero/main typecheck`
Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/renderer test parity`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/trust-handlers.ts apps/main/tests/trust-handlers.test.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts apps/renderer/src/components/trust/TrustTierBadge.tsx apps/renderer/src/routes/Agents.tsx apps/renderer/src/components/agent-panel/AgentHeader.tsx apps/renderer/src/i18n
git commit -m "feat(trust): show blockedReason tooltip on the tier badge"
```

---

## Task 3: Live refresh da Vitrine via `INBOX_UPDATE`

**Files:**
- Modify: `apps/renderer/src/stores/briefing.ts`
- Modify: `apps/renderer/src/routes/Briefing.tsx`

> Read `apps/renderer/src/stores/inbox.ts` for the existing `onUpdate` subscriber pattern (M5/M11). The Vitrine doesn't need to mirror the inbox store — it just needs to call `load(companyId)` on update.

- [ ] **Step 1: Add `subscribeInbox` to the store**

In `apps/renderer/src/stores/briefing.ts`, extend the interface:

```typescript
interface BriefingState {
  // ...existing fields...
  subscribeInbox: (companyId: string) => () => void;
}
```

And the implementation inside `create<BriefingState>((set, get) => ({ ... }))`:

```typescript
subscribeInbox(companyId) {
  const off = window.prospero.inbox.onUpdate(() => {
    void get().load(companyId);
  });
  return off;
},
```

(The factory `create<...>((set, get) => ...)` already has access to `get` if it's declared in the function signature. If the current store doesn't take `get`, change `create<BriefingState>((set) => ({...}))` to `create<BriefingState>((set, get) => ({...}))`.)

- [ ] **Step 2: Subscribe in `Briefing.tsx`**

In `apps/renderer/src/routes/Briefing.tsx`, add to the existing `useEffect` block that calls `load(activeCompanyId)`:

```tsx
useEffect(() => {
  if (activeCompanyId === null) return;
  void load(activeCompanyId);
  const off = subscribeInbox(activeCompanyId);
  return off;
}, [activeCompanyId, load, subscribeInbox]);
```

Destructure `subscribeInbox` from the store at the top (mirror `load`):

```typescript
const subscribeInbox = useBriefingStore((s) => s.subscribeInbox);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/stores/briefing.ts apps/renderer/src/routes/Briefing.tsx
git commit -m "feat(briefing): live-refresh when inbox changes"
```

---

## Task 4: Polish UI da Vitrine

**Files:**
- Modify: `apps/renderer/src/routes/Briefing.tsx`

> No test file — visual polish. Cap: **200 LOC net new**. Goal: improve the briefing page from "functional" to "production-grade".

- [ ] **Step 1: Capture the current state**

Run: `wc -l apps/renderer/src/routes/Briefing.tsx`
Note the current size. Read the file end-to-end to understand the layout.

- [ ] **Step 2: Invoke `frontend-design`**

> Use the **frontend-design skill** (`Skill` tool) with the following brief:
>
> *"Polish `Briefing.tsx`. Constraints: Tailwind tokens only (real tokens from `apps/renderer/tailwind.config.ts`); no emojis (project rule); cap +200 LOC. The page has: a headline at top, a 'Precisa de você' bucket (always visible), four collapsable buckets (verified / failed / inProgress / learned), and a cost footer. Improvements wanted: strong visual hierarchy with 'Precisa de você' dominating; SVG dots per bucket (mirror `TrustTierBadge` pattern); better vertical rhythm; loading/error states explicit but compact. Do NOT change the store, the route flip, or the IPC."*

Apply the design proposal. Keep changes inside `Briefing.tsx`. Reject any proposal that would touch other files.

- [ ] **Step 3: Verify the cap**

Run: `wc -l apps/renderer/src/routes/Briefing.tsx`
The delta should be ≤ 200 lines. If it exceeds, trim before committing.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/renderer lint`
Expected: both clean.

- [ ] **Step 5: Run the renderer test suite**

Run: `pnpm --filter @prospero/renderer test`
Expected: 168 still green.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/routes/Briefing.tsx
git commit -m "feat(briefing): polish UI"
```

---

## Task 5: `SECURITY.md` — Trust ladder + Morning briefing

**Files:**
- Modify: `SECURITY.md`

> Read `SECURITY.md` end-to-end. Pick an insertion point near the existing M13 sections (Containment zones / Verification as attack surface).

- [ ] **Step 1: Add the Trust ladder section**

Append (or insert at the appropriate spot after the M13 sections):

```markdown
## Trust ladder — earned autonomy (M14 PR-A/B)

A per-agent trust tier (`novato → confiavel → autonomo`) that a track record
of verified outcomes raises automatically. The gate auto-approves read-only
tool calls (`Read`, `Glob`, `Grep`, `list_*`, `*_read`) for non-`novato`
agents — but never write/edit/Bash. Promotion to `autonomo` (which flips the
Run Policy `mode` to `auto`) is suggestion-only: the engine files a
`trust_promotion_suggested` inbox card; the user must approve.

Mitigations:

- **Demotion is immediate and non-blocking.** A verification failure flips
  the tier back to `novato` synchronously, even before the user sees it.
- **The agent cannot self-certify.** Track record is computed from
  `goals.status = 'achieved'` and `goal_criteria.status` — both written
  exclusively by the verification engine (M13), which is orchestrator-side
  and out of the agent's reach.
- **Every transition is audited** in `trust_events` (`promoted` /
  `demoted` / `promotion_suggested`) and as an `activity_event`. Every
  read-only auto-approve is also audited (`trust.readonly_autoapproved`).
- **Score is not stored.** The eligible tier is computed on demand from
  existing tables; no stale state to invalidate.

Known gap (tracked for V2):

- Manual override of `agents.mode` by the user is NOT reverted by the
  ladder. If the user forces `mode=auto` on a `novato` agent, the ladder
  records the divergence but respects the user's choice. This is a
  conscious trade — the user retains final control of the run policy.
```

- [ ] **Step 2: Add the Morning briefing section**

Append:

```markdown
## Morning briefing — read-only triage surface (M14 PR-C)

The Vitrine Matinal is a read-only triage page. The only write surface is
`companies.briefing_reviewed_at` (a cursor), updated by an explicit user
action. The headline is generated by one `claude -p` call per user action,
cached on `companies.briefing_headline_json` by hash of the input counters
(six small integers), so opening the page repeatedly in the same state
costs zero new calls. On call failure, the page falls back to a
deterministic headline; the cache is NOT written on failure so the next
call retries.

Threat surface:

- The counters fed to the headline are six aggregate integers — no agent
  output, no user input, no path strings. Nothing sensitive flows into the
  `claude -p` prompt.
- The IPC `briefing:get` is read-only; it reads tables already exposed via
  other IPCs (inbox, goals, costs). No new data egress.
- `briefing:mark-reviewed` is the only write. It accepts only a company id
  and stamps `Date.now()` — no user-controlled timestamp.
```

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs(security): document trust ladder and morning briefing"
```

---

## Task 6: `roadmap.html` refresh

**Files:**
- Modify: `docs/roadmap.html`

> Read `docs/roadmap.html` end-to-end (~1700 lines). The page has sections `/00` (overview) and `/03` (status) plus a `#poder` cards block and a calculator. Read `ROADMAP.md` "Em linguagem simples" for the source-of-truth narrative on M14.

- [ ] **Step 1: Survey the page**

Run: `grep -n '<section\|id="poder"\|simulator\|calculator' docs/roadmap.html | head -20`
Identify the M14-relevant spots: the "O que já funciona hoje" list in `#jornada`, the timeline `PHASES` JS array, and any cards in `#poder` that touch trust/briefing topics.

- [ ] **Step 2: Add M14 to "O que já funciona hoje"**

In the `#jornada` "O que já funciona hoje" list, append two new bullets in the lay-friendly tone of the existing list (no jargon — "funcionário" not "agente"; "manhã do briefing" not "Vitrine Matinal"):

```html
<li>
  <strong>Confiança que cresce com o uso</strong> — funcionário que entrega
  bem progride numa escada de três degraus (novato → confiável → autônomo).
  A partir de "confiável", ler arquivos do projeto não pede mais
  aprovação. Quando o funcionário está pronto pra virar autônomo, o app
  pede sua aprovação. Se errar, volta pra novato na hora.
</li>
<li>
  <strong>Manhã do briefing</strong> — você abre o app de manhã e vê um
  resumo do que rodou enquanto dormia: o que precisa de você (no topo), o
  que foi entregue, o que falhou, o que está em andamento, e quanto custou
  a noite. Marca como revisado e volta no dia seguinte.
</li>
```

(Adapt the exact wording to mirror the surrounding tone — the file already uses Portuguese consistently.)

- [ ] **Step 3: Trim "Para onde vamos" of items M14 just shipped**

In the `#jornada` "Para onde vamos" list, remove any items that M14 just delivered (e.g. "Autonomia que cresce" or "Tela inicial de revisão" — wording depends on what's there). Replace with the M15 (Routines) bullet:

```html
<li>
  <strong>Funcionários que acordam sozinhos</strong> — agendamento de
  rotinas: o funcionário acorda em horário marcado ou quando algo
  acontece, faz o trabalho e dorme de novo.
</li>
```

(Confirm the exact list shape in the file before editing.)

- [ ] **Step 4: Update the timeline `PHASES`**

Find the `const PHASES = [...]` array in the JS section. Update "Hoje" to mention M14 deliveries and "Próximo" to mention M15:

```javascript
{
  title: "Hoje — você está aqui",
  body: "Verificação automática do que ficou pronto, escada de confiança com 3 degraus, briefing matinal com manchete da noite. M14 entregue.",
},
{
  title: "Próximo",
  body: "Rotinas: funcionários que acordam sozinhos por horário ou por evento. Async governance pra escaladas noturnas resolverem sem você.",
},
```

(Mirror the file's existing entries — copy/paste shape, not invent fields.)

- [ ] **Step 5: Fix "agente → funcionário" in the calculator/simulator**

Run: `grep -n "agente\b" docs/roadmap.html | head -20`
Note any occurrences in the calculator (around `id="calculator"` or wherever the cost simulator lives) and in the simulator panel. Replace `agente` / `agentes` with `funcionário` / `funcionários` in user-facing strings ONLY (not in JS identifier names like `agentCount` — leave those alone). Use Edit replace_all on the file with the exact strings.

For example:
- `"Tamanho do time: 3 agentes"` → `"Tamanho do time: 3 funcionários"`
- `"Um agente-CEO"` → `"Um funcionário-CEO"`
- `"cada agente"` → `"cada funcionário"`

(Search results may differ; adapt to what `grep` returns.)

- [ ] **Step 6: Visual smoke (manual)**

Open `docs/roadmap.html` in a browser. Check:
- All animations still play.
- Layout responsive (resize the window).
- No console errors.
- New bullets render and read naturally.

Note any issues in the commit message; don't block the commit on visual perfection.

- [ ] **Step 7: Commit**

```bash
git add docs/roadmap.html
git commit -m "docs(roadmap): refresh public roadmap.html for m14"
```

---

## Task 7: Non-regression audit

**Files:** none (verification only).

- [ ] **Step 1: Whole-monorepo typecheck**

Run: `pnpm typecheck`
Expected: clean across all 4 packages.

- [ ] **Step 2: Whole-monorepo lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Whole-monorepo tests**

Run: `pnpm test`
Expected: green. Baseline going in is 1641 + 2 todo. PR-D adds:
- `agents/repository.test.ts`: +1 case
- `agents.delta-handlers.test.ts`: +2 cases
- `trust-handlers.test.ts`: +2 cases

Expected delta: **+5 tests**, total ~**1646** + 2 todo. Note actual.

- [ ] **Step 4: IPC channels sanity**

Run: `pnpm --filter @prospero/shared test ipc-channels`
Expected: PASS — uniqueness + casing assertions still hold with the new channel.

- [ ] **Step 5: Security suite**

Run: `pnpm --filter @prospero/main test "security"`
Expected: all security tests green (no PR-D changes touched the gate, but the suite is the load-bearing assurance).

- [ ] **Step 6: Token efficiency confirmation**

Run:
```
grep -rn "trust_tier\|briefing_reviewed_at\|trust:get-evaluation\|trust-tier-changed" apps/main/src/orchestrator/
```
Expected: empty. PR-D adds nothing to any agent's system prompt — the new IPC is renderer-pull, the new broadcast is renderer-push.

- [ ] **Step 7: Manual smoke checklist (PENDING — for the human)**

The Electron app cannot run from this environment. List in the report:

1. Promote an agent's trust tier (e.g. directly via `setTrustTier` in dev console). Confirm the badge in `/agents` list and `/agents/:id` header updates **without reload**.
2. Hover the tier badge on a novato agent with some verified outcomes. Confirm the tooltip shows the `blockedReason` (e.g. "1 falha de verificação no período").
3. Open `/briefing`. Create a new inbox item externally. Confirm the page refreshes automatically (no manual reload).
4. Visually inspect the polished Briefing page against the pre-polish baseline.

- [ ] **Step 8: Optional cleanup commit (only if Step 1 or 2 surfaced fixes)**

If a type literal or count assertion needed touching:

```bash
git add -A
git commit -m "test(m14): non-regression audit"
```

Otherwise skip — Task 7 is a checkpoint.

---

## Self-Review (completed by plan author)

**Spec coverage (§3 of the spec):**

- §3.1 (live broadcast) → Task 1 ✓
- §3.2 (`blockedReason` tooltip via `trust:get-evaluation`) → Task 2 ✓
- §3.3 (live refresh Vitrine) → Task 3 ✓
- §3.4 (polish UI Vitrine, cap 200 LOC) → Task 4 ✓
- §3.5 (SECURITY.md two sections) → Task 5 ✓
- §3.6 (roadmap.html refresh + fix "agente→funcionário") → Task 6 ✓
- §3.7 (audit) → Task 7 ✓

**Placeholder scan:** every code-changing step shows code. Four adapt points flagged explicitly: Task 1 Step 3 (electron mock idiom — file may already have one), Task 2 Step 2 (`recorder` variable name in `trustHandlers`), Task 3 Step 1 (the `(set, get)` signature of `create<BriefingState>`), Task 6 Step 5 (exact `grep` results dictate which strings to replace). All four are "find this; mirror it", not "TBD".

**Type consistency:** `TrustTier` from `@prospero/shared` is used in Tasks 1 (event variant + store action), 2 (handler). `TierEvaluation` defined in PR-A's `packages/shared/src/types/trust.ts`, consumed in Task 2 (handler + preload + badge). `AgentEvent` extended in Task 1 Step 1, consumed in Tasks 1 Step 7 (App.tsx switch). `broadcastAgentEvent` defined in Task 1 Step 2, consumed in Task 1 Step 4 (repo).

**Token efficiency:** zero impact on any agent system prompt (Task 7 Step 6 verifies). All new IPC and broadcast traffic is renderer-side.

**Security:** no new write surfaces beyond what the spec authorizes. `trust:get-evaluation` is read-only and computed on demand. `broadcastAgentEvent` reuses an existing channel. SECURITY.md is updated to document both the Trust ladder (with the known V2 gap explicit) and the Morning briefing (with the data-flow rationale for why the headline prompt cannot leak sensitive data).
