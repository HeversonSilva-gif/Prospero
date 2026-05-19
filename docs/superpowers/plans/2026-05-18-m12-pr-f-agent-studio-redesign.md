# M12 PR-F — Agent Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `/agents/:id` screen into two modes (Conversa / Estúdio), unify the six studio tabs under one full-width tab bar, and give the Agent Studio a consistent visual language via a small shared UI-primitive set.

**Architecture:** Renderer-only refactor. `Agent.tsx` becomes a two-mode shell (a persistent `AgentHeader` + a mode switch + either `AgentConversation` or `AgentStudio`). The 320px `AgentConfigPanel` sidebar is deleted; its 5 tabs plus the M11 Learning panel become the six full-width tabs of `AgentStudio`. The six tab components are redesigned internally to share new `components/ui/` primitives (`Section`, `EmptyState`, `LoadingState`, `TabBar`) and one consistency contract. No backend, IPC, migration, or `@prospero/shared` change — **token-neutral by construction**.

**Tech Stack:** React 18 + TypeScript, Tailwind, react-i18next, vitest. Spec: `docs/superpowers/specs/2026-05-18-m12-pr-f-agent-studio-redesign-design.md`.

---

## How to read this plan

PR-F is a **UI redesign**. The repo has no React Testing Library (project rule: pure-helper tests over RTL), and PR-F adds almost no testable logic. So:

- **Tasks 1, 2, 9** are deterministic structure — they carry complete code.
- **Tasks 3–8** are *redesign* tasks. Each one carries an exhaustive **behavior-preservation contract** (every prop, IPC call, and control that must keep working) and a **structural target**, then instructs the implementer to invoke the **`frontend-design` skill** to produce the polished JSX. The spec (§4, §11/§16 of the M12 design doc) deliberately delegates the fine visual design ("IA fina") to `frontend-design` at implementation time — that delegation is intentional, not a placeholder.
- Verification across all tasks is `pnpm -r typecheck` + `pnpm -r lint` + the existing **168 renderer tests** staying green + the i18n **parity test** green. New i18n keys land in Task 9; tab tasks may render raw key strings until then (same pattern as M12 PR-E2).

Commit subject rules: commitlint rejects uppercase / `+` / `%`. The pre-commit hook reformats with prettier — let it. Windows shows a harmless CRLF warning.

---

## File Structure

**Created:**
- `apps/renderer/src/components/ui/Section.tsx` — titled section wrapper.
- `apps/renderer/src/components/ui/EmptyState.tsx` — consistent empty placeholder.
- `apps/renderer/src/components/ui/LoadingState.tsx` — consistent loading indicator.
- `apps/renderer/src/components/ui/TabBar.tsx` — tab bar (`segmented` / `underline`).
- `apps/renderer/src/components/ui/index.ts` — barrel export.
- `apps/renderer/src/components/agent-panel/AgentConversation.tsx` — Conversa mode (chat/delegations + composer), extracted from `Agent.tsx`.
- `apps/renderer/src/components/agent-panel/AgentStudio.tsx` — Estúdio mode (6-tab bar + content), replaces `AgentConfigPanel.tsx`.
- `docs/agent-studio.md` — M12 capstone doc.

**Modified:**
- `apps/renderer/src/routes/Agent.tsx` — two-mode shell.
- `apps/renderer/src/components/agent-panel/ConfigTab.tsx` — redesigned (2-col).
- `apps/renderer/src/components/agent-panel/InstructionsTab.tsx` — redesigned (tree + editor side by side).
- `apps/renderer/src/components/agent-panel/LearningPanel.tsx` — adopt `TabBar` + contract.
- `apps/renderer/src/components/agent-panel/IssuesTab.tsx` — redesigned + `semantic-info` fix.
- `apps/renderer/src/components/agent-panel/RunsTab.tsx` — redesigned.
- `apps/renderer/src/components/agent-panel/StatsTab.tsx` — redesigned.
- `apps/renderer/tailwind.config.ts` + `apps/renderer/src/styles/tokens.css` (or wherever the theme CSS lives) — add `semantic-info` tokens.
- `apps/renderer/src/i18n/en-US.json`, `pt-BR.json` — new keys.
- `docs/m12-agent-org-definition-layer.md`, `ROADMAP.md` — doc updates.

**Deleted:**
- `apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx` — superseded by `AgentStudio.tsx`.

---

## Task 1: Shared UI primitives + `semantic-info` tokens

**Files:**
- Create: `apps/renderer/src/components/ui/Section.tsx`, `EmptyState.tsx`, `LoadingState.tsx`, `TabBar.tsx`, `index.ts`
- Modify: `apps/renderer/tailwind.config.ts` and the theme CSS file

- [ ] **Step 1: Create `Section.tsx`**

`apps/renderer/src/components/ui/Section.tsx`:

```tsx
import type { FC, ReactNode } from "react";

type Props = { title: string; hint?: string; children: ReactNode };

// Titled block used by every Estúdio tab. Replaces the hand-rolled
// `<section>` + `<h3 className="text-[10px] uppercase…">` pattern.
export const Section: FC<Props> = ({ title, hint, children }) => (
  <section className="space-y-2">
    <h3 className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">{title}</h3>
    {children}
    {hint !== undefined && <p className="text-[10px] text-ink-soft">{hint}</p>}
  </section>
);
```

- [ ] **Step 2: Create `EmptyState.tsx`**

`apps/renderer/src/components/ui/EmptyState.tsx`:

```tsx
import type { FC, ReactNode } from "react";

type Props = { message: string; icon?: ReactNode };

export const EmptyState: FC<Props> = ({ message, icon }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
    {icon !== undefined && <div className="text-2xl opacity-40">{icon}</div>}
    <p className="text-xs text-ink-soft">{message}</p>
  </div>
);
```

- [ ] **Step 3: Create `LoadingState.tsx`**

`apps/renderer/src/components/ui/LoadingState.tsx`:

```tsx
import type { FC } from "react";

export const LoadingState: FC<{ label?: string }> = ({ label }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-xs text-ink-soft">
    <span className="w-3 h-3 rounded-full border-2 border-ink-soft border-t-transparent animate-spin" />
    {label !== undefined && <span>{label}</span>}
  </div>
);
```

- [ ] **Step 4: Create `TabBar.tsx`**

`apps/renderer/src/components/ui/TabBar.tsx`:

```tsx
import type { FC } from "react";

export type TabBarTab = { id: string; label: string; badge?: number };

type Props = {
  tabs: TabBarTab[];
  active: string;
  onSelect: (id: string) => void;
  variant: "segmented" | "underline";
};

export const TabBar: FC<Props> = ({ tabs, active, onSelect, variant }) => {
  if (variant === "segmented") {
    return (
      <div className="inline-flex gap-0.5 p-0.5 bg-surface-soft rounded">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`px-3 py-1 text-xs font-medium rounded flex items-center gap-1.5 ${
              active === tab.id
                ? "bg-surface-card text-brand shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="text-[10px] bg-surface-border text-ink-muted px-1.5 py-0.5 rounded-full">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex border-b border-surface-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px flex items-center gap-1.5 ${
            active === tab.id
              ? "border-brand text-brand"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="text-[10px] bg-surface-soft text-ink-muted px-1.5 py-0.5 rounded-full">
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
```

- [ ] **Step 5: Create the barrel `index.ts`**

`apps/renderer/src/components/ui/index.ts`:

```ts
export { Section } from "./Section.js";
export { EmptyState } from "./EmptyState.js";
export { LoadingState } from "./LoadingState.js";
export { TabBar, type TabBarTab } from "./TabBar.js";
```

- [ ] **Step 6: Add the `semantic-info` design tokens**

Read `apps/renderer/tailwind.config.ts` and find the `semantic-purple` / `semantic-purple-bg` color entries. Add two siblings, following the exact same syntax:

```ts
"semantic-info": "#2563eb",
"semantic-info-bg": "#dbeafe",
```

Then find the theme CSS file (the one with `semantic-purple` — search `apps/renderer/src` for `semantic-purple`; it is the `tokens.css` / theme file). If `semantic-*` colors there are literal hex values reused by both light and dark blocks, add `semantic-info` / `semantic-info-bg` the same way. If the Tailwind config uses literal hex (not CSS vars) for `semantic-*` — as `semantic-purple: "#7c3aed"` suggests — then only the Tailwind config edit is needed; confirm by checking whether `semantic-purple` appears in the CSS file at all.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @prospero/renderer typecheck`
Expected: CLEAN.

- [ ] **Step 8: Commit**

```bash
git add apps/renderer/src/components/ui apps/renderer/tailwind.config.ts apps/renderer/src/styles
git commit -m "feat(studio): add shared ui primitives and semantic-info token"
```

---

## Task 2: Two-mode shell

Restructure `Agent.tsx` into a column layout: persistent `AgentHeader`, a mode switch, then `AgentConversation` or `AgentStudio`. Extract the conversation into `AgentConversation`; replace `AgentConfigPanel` with `AgentStudio`.

**Files:**
- Create: `apps/renderer/src/components/agent-panel/AgentConversation.tsx`
- Create: `apps/renderer/src/components/agent-panel/AgentStudio.tsx`
- Modify: `apps/renderer/src/routes/Agent.tsx`
- Delete: `apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx`

- [ ] **Step 1: Create `AgentConversation.tsx`**

`apps/renderer/src/components/agent-panel/AgentConversation.tsx` — extracted verbatim from the current `Agent.tsx` (message loading, the message-append subscription, the permission-request subscription, the chat/delegation split, `resolve`, `onSend`), with the `chat`/`delegations` tabs now a segmented `TabBar`:

```tsx
import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Message, PermissionRequest, PermissionResolution } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { ApprovalCard } from "../ApprovalCard.js";
import { MessageList } from "../MessageList.js";
import { DelegationsPanel } from "../DelegationsPanel.js";
import { Composer } from "../Composer.js";
import { TabBar } from "../ui/index.js";

type SubTab = "chat" | "delegations";
type Props = { agent: Agent };

export const AgentConversation: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PermissionRequest[]>([]);
  const [sub, setSub] = useState<SubTab>("chat");

  useEffect(() => {
    void (async () => {
      const all = await window.prospero.messages.listByAgent(agent.id);
      setMessages(all);
    })();
  }, [agent.id]);

  useEffect(() => {
    const off = window.prospero.agents.onEvent((ev) => {
      if (ev.kind === "message-append") {
        void (async () => {
          const all = await window.prospero.messages.listByAgent(agent.id);
          setMessages(all);
        })();
      }
    });
    return off;
  }, [agent.id]);

  useEffect(() => {
    const unsub = window.prospero.permissions.onRequest((req) => {
      if (req.agentId === agent.id) {
        setPendingApprovals((prev) => [...prev, req]);
      }
    });
    return unsub;
  }, [agent.id]);

  const { chatMessages, delegationMessages } = useMemo(() => {
    const chat: Message[] = [];
    const delegation: Message[] = [];
    for (const m of messages) {
      const parts = m.threadParticipants;
      if (parts === undefined || parts.includes("user")) chat.push(m);
      else delegation.push(m);
    }
    return { chatMessages: chat, delegationMessages: delegation };
  }, [messages]);

  const resolve = (req: PermissionRequest, allow: boolean): void => {
    const resolution: PermissionResolution = allow
      ? { behavior: "allow" }
      : { behavior: "deny", message: "User rejected" };
    void window.prospero.permissions.resolve(req.toolUseId, resolution);
    setPendingApprovals((prev) => prev.filter((r) => r.toolUseId !== req.toolUseId));
  };

  const onSend = async (content: string): Promise<void> => {
    await window.prospero.agents.sendMessage(agent.id, content);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 pt-2">
        <TabBar
          variant="segmented"
          active={sub}
          onSelect={(id) => setSub(id as SubTab)}
          tabs={[
            { id: "chat", label: t("agent.tabs.chat") },
            {
              id: "delegations",
              label: t("agent.tabs.delegations"),
              badge: delegationMessages.length,
            },
          ]}
        />
      </div>
      {sub === "chat" ? (
        <MessageList messages={chatMessages} agents={agents} />
      ) : (
        <DelegationsPanel
          messages={delegationMessages}
          currentAgentId={agent.id}
          agents={agents}
        />
      )}
      {pendingApprovals.map((req) => (
        <ApprovalCard
          key={req.toolUseId}
          request={req}
          onResolve={(allow) => resolve(req, allow)}
        />
      ))}
      <Composer onSubmit={(text) => void onSend(text)} />
    </div>
  );
};
```

- [ ] **Step 2: Create `AgentStudio.tsx`**

`apps/renderer/src/components/agent-panel/AgentStudio.tsx` — replaces `AgentConfigPanel`. Six full-width tabs; `tab` state is lifted to `Agent.tsx` so the header's 🎓 badge can jump to Learning:

```tsx
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Skill, Memory } from "@prospero/shared";
import { ConfigTab } from "./ConfigTab.js";
import { InstructionsTab } from "./InstructionsTab.js";
import { LearningPanel } from "./LearningPanel.js";
import { IssuesTab } from "./IssuesTab.js";
import { RunsTab } from "./RunsTab.js";
import { StatsTab } from "./StatsTab.js";
import { TabBar } from "../ui/index.js";

export type StudioTab = "config" | "instructions" | "learning" | "issues" | "runs" | "stats";

type Props = {
  agent: Agent;
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
  skills: Skill[];
  memories: Memory[];
};

const TABS: StudioTab[] = ["config", "instructions", "learning", "issues", "runs", "stats"];

export const AgentStudio: FC<Props> = ({ agent, tab, onTab, skills, memories }) => {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6">
        <TabBar
          variant="underline"
          active={tab}
          onSelect={(id) => onTab(id as StudioTab)}
          tabs={TABS.map((k) => ({ id: k, label: t(`agent.panel.tabs.${k}`) }))}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "instructions" && <InstructionsTab agentId={agent.id} />}
        {tab === "learning" && (
          <LearningPanel agentId={agent.id} skills={skills} memories={memories} />
        )}
        {tab === "issues" && <IssuesTab agentId={agent.id} companyId={agent.companyId} />}
        {tab === "runs" && <RunsTab agentId={agent.id} companyId={agent.companyId} />}
        {tab === "stats" && <StatsTab agentId={agent.id} />}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Rewrite `Agent.tsx` as the two-mode shell**

Replace the entire contents of `apps/renderer/src/routes/Agent.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { AgentHeader } from "../components/agent-panel/AgentHeader.js";
import { AgentConversation } from "../components/agent-panel/AgentConversation.js";
import { AgentStudio, type StudioTab } from "../components/agent-panel/AgentStudio.js";
import { TabBar } from "../components/ui/index.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";

type Mode = "conversa" | "estudio";

export const Agent = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [mode, setMode] = useState<Mode>("conversa");
  const [studioTab, setStudioTab] = useState<StudioTab>("config");
  const [showAssignTask, setShowAssignTask] = useState(false);

  // M11 skills/memory feed the header 🎓 badge and the Learning tab.
  // Refetched whenever the studio (re-)opens the Learning tab.
  useEffect(() => {
    if (agent === undefined) return;
    void (async () => {
      const [s, m] = await Promise.all([
        window.prospero.learning.listSkills(agent.id),
        window.prospero.learning.listMemories(agent.id),
      ]);
      setSkills(s);
      setMemories(m);
    })();
  }, [agent, mode, studioTab]);

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex flex-col h-screen min-w-0">
      <AgentHeader
        agent={agent}
        onAssignTask={() => setShowAssignTask(true)}
        skillCount={skills.length}
        memoryCount={memories.length}
        onOpenLearning={() => {
          setMode("estudio");
          setStudioTab("learning");
        }}
      />
      <div className="px-6 py-2 border-b border-surface-border">
        <TabBar
          variant="segmented"
          active={mode}
          onSelect={(id) => setMode(id as Mode)}
          tabs={[
            { id: "conversa", label: t("agent.mode.conversa") },
            { id: "estudio", label: t("agent.mode.estudio") },
          ]}
        />
      </div>
      {mode === "conversa" ? (
        <AgentConversation agent={agent} />
      ) : (
        <AgentStudio
          agent={agent}
          tab={studioTab}
          onTab={setStudioTab}
          skills={skills}
          memories={memories}
        />
      )}
      {showAssignTask && (
        <IssueFormModal
          companyId={agent.companyId}
          initialAssigneeId={agent.id}
          onClose={() => setShowAssignTask(false)}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 4: Delete `AgentConfigPanel.tsx`**

```bash
git rm apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx
```

Then grep for any other importer: `grep -rn "AgentConfigPanel" apps/renderer/src` — there should be none after `Agent.tsx` is rewritten. If grep finds one, fix it.

- [ ] **Step 5: Typecheck + lint + full renderer suite**

Run: `pnpm --filter @prospero/renderer typecheck && pnpm --filter @prospero/renderer lint && pnpm --filter @prospero/renderer test`
Expected: typecheck/lint CLEAN; 168 renderer tests PASS. `agent.mode.*` and `agent.panel.tabs.learning` render as raw key strings for now — Task 9 adds them.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src
git commit -m "feat(studio): split agent screen into conversa and estudio modes"
```

---

## Tasks 3–8: redesign the six Estúdio tabs

Each of Tasks 3–8 follows the same shape. **Use the `frontend-design` skill** for the visual work. Every task MUST preserve its tab's behavior contract exactly — the redesign is visual + structural only. Generic per-task steps:

1. Invoke the `frontend-design` skill; redesign the tab to the structural target below, using the `Section` / `EmptyState` / `LoadingState` / `TabBar` primitives from `components/ui/`, the `p-6` + `space-y-6` contract, and the existing Tailwind tokens.
2. Run `pnpm --filter @prospero/renderer typecheck && pnpm --filter @prospero/renderer lint` → CLEAN.
3. Run `pnpm --filter @prospero/renderer test` → 168 tests PASS.
4. Verify the behavior contract: read the redesigned file and confirm every listed prop, IPC call, store action, and control is still wired.
5. Commit.

New user-facing strings must go through `t()` with keys under `agent.studio.<tab>.*`; Task 9 collects them into the JSON files.

---

### Task 3: ConfigTab redesign

**Files:** Modify `apps/renderer/src/components/agent-panel/ConfigTab.tsx`

**Structural target:** a **2-column grid** of `Section`s, `p-6` outer padding. Left column: Identity — Role (+ `ChangeRoleModal`), Model (preset select + custom input), Reports-to, Location (local/remote adapter). Right column: Run Policy (the consolidated PR-E2 section — mode radios, always-on, can-hire, can-assign), Schedule (wake-up), Capabilities, Projects.

**Behavior-preservation contract — every one of these MUST still work:**
- Store actions: `setModel`, `setRole`, `setReportsTo`, `setMode`, `setAlwaysOn`, `setCapabilities`, `setPermissions`, `setAdapter`, `wakeUp` (all from `useAgentsStore`).
- `window.prospero.roles.list()` call on mount; `currentRole` lookup by `agent.templateId`.
- Model preset list `CLAUDE_MODEL_PRESETS`, custom-model `MODEL_ID_REGEX` validation + error message, the `modelPreset`/`customModel`/`modelError` state.
- `categorizeCapabilities` → required / optional / available capability rendering; the add-capability `<select>`.
- `<AgentProjectsEditor agent={agent} allProjects={allProjects} />` rendered as-is.
- `<ChangeRoleModal>` opened by the role "change" button.
- The Location radio computing `claude-oauth-remote-docker` vs `claude-api-key-local`/`claude-oauth-local` from `authMode`.
- All existing `agent.config.*` / `agent.location.*` i18n keys keep working.

Replace each hand-rolled `<section>`+`<h3>` with `<Section title={...} hint={...}>`. Do not change any IPC, store, or validation logic.

---

### Task 4: InstructionsTab redesign

**Files:** Modify `apps/renderer/src/components/agent-panel/InstructionsTab.tsx`

**Structural target:** a **two-pane layout** at `p-6` — a file tree/list on the left (~200px) and the editor on the right (flex-1), side by side instead of stacked. The editor textarea fills the available width/height.

**Behavior-preservation contract:**
- IPCs: `window.prospero.instructions.list/read/write/add/delete` — all preserved.
- The file list, the selected-file state, the "Add" file action, the textarea editor, the save action, the success/error messages, the footer note.
- All existing `agent.instructions.*` (or equivalent) i18n keys.

---

### Task 5: LearningPanel — adopt the contract

**Files:** Modify `apps/renderer/src/components/agent-panel/LearningPanel.tsx`

**Structural target:** LearningPanel is large (487 lines) and its behavior is **not** refactored. Only: (a) its 4 sub-tabs (Skills / Memory / History / Candidates) render via `<TabBar variant="underline">` instead of the hand-rolled button row; (b) it drops its own outer `flex-1` scroll wrapper so it nests cleanly inside `AgentStudio`'s `overflow-y-auto` content area (no double scrollbar); (c) sub-views adopt the `p-6` padding + `EmptyState`/`LoadingState` where they currently hand-roll them.

**Behavior-preservation contract:**
- The 4 sub-views `SkillsView` / `MemoryView` / `HistoryView` / `CandidatesView` and their data flow are untouched.
- The `agentId` / `skills` / `memories` props are unchanged.
- All `agent.learning.*` i18n keys keep working.

Keep this task minimal — it is an adoption pass, not a rewrite.

---

### Task 6: IssuesTab redesign

**Files:** Modify `apps/renderer/src/components/agent-panel/IssuesTab.tsx`

**Structural target:** `p-6`, wrapped in a `Section` (the tab currently has **no heading at all**). Loading → `<LoadingState>`; empty → `<EmptyState>`. The issue list gets room to breathe at full width.

**Behavior-preservation contract:**
- The issues query/IPC the tab uses, the per-issue row (status dot + title + link/navigation), the status-color mapping.
- **Fix:** the status-color map references `bg-semantic-info` for the `review` status — that token now exists (Task 1). Confirm the `review` row renders the info color.
- All existing i18n keys.

---

### Task 7: RunsTab redesign

**Files:** Modify `apps/renderer/src/components/agent-panel/RunsTab.tsx`

**Structural target:** `p-6`. Keep the per-session grouping, but render each session group with `<Section>`. Loading → `<LoadingState>`, empty → `<EmptyState>`. The expanded run drill-in uses the full width — token/cost/model/adapter/activity laid out side by side rather than stacked.

**Behavior-preservation contract:**
- `window.prospero.runs.list(agentId)`; `groupRunsBySession`; the expand/collapse state; the per-run drill-in calling `window.prospero.activity.query({ agentId, sinceMs, untilMs })`; the stale-result guard.
- All existing `agent.runs.*` i18n keys.

---

### Task 8: StatsTab redesign

**Files:** Modify `apps/renderer/src/components/agent-panel/StatsTab.tsx`

**Structural target:** `p-6`, a **2-column grid** — metrics (turns, last activity, 7-day token/cost breakdown) on one side, the `<BudgetSection>` on the other (or stacked `Section`s if that reads better at full width — `frontend-design` decides). The budget utilization bars and the limit-edit form get the extra width.

**Behavior-preservation contract:**
- `useAgentsStore` `fetchStats`; `useCostsQuery` with `{ range: "7d", scope: "agent", refId: agentId }`; `formatCents`/`formatTokens`.
- `<BudgetSection agentId={agentId} />` rendered as-is (it is a PR-E2 component — do NOT modify it).
- The `<Link to="/costs">`.
- All existing `agent.stats.*` i18n keys.

---

## Task 9: i18n keys

**Files:** Modify `apps/renderer/src/i18n/en-US.json`, `apps/renderer/src/i18n/pt-BR.json`

- [ ] **Step 1: Add the mode-switch + Learning tab keys**

In **both** files, under `agent`, add a `mode` object and ensure `agent.panel.tabs.learning` exists.

`en-US.json` — `agent.mode`:
```json
"mode": { "conversa": "Conversation", "estudio": "Studio" }
```
`pt-BR.json` — `agent.mode`:
```json
"mode": { "conversa": "Conversa", "estudio": "Estúdio" }
```

In **both** files, inside the existing `agent.panel.tabs` object, add a `learning` key if it is not already present:
- `en-US.json`: `"learning": "Learning"`
- `pt-BR.json`: `"learning": "Aprendizado"`

(Match whatever wording the existing `agent.tabs.learning` key already uses, for consistency.)

- [ ] **Step 2: Collect any keys introduced by Tasks 3–8**

Run: `git diff 5f46a6e..HEAD -- apps/renderer/src/components/agent-panel apps/renderer/src/routes/Agent.tsx | grep -oE 't\("agent\.[a-zA-Z0-9_.]+"\)'` (adjust the base SHA to PR-F's first commit). For every `agent.*` key referenced that is NOT yet in `en-US.json`, add it to **both** files with sensible English and Brazilian-Portuguese values. Keys for redesigned tabs live under `agent.studio.<tab>.*`.

- [ ] **Step 3: Run the parity test + full renderer suite**

Run: `pnpm --filter @prospero/renderer test -- parity.test.ts && pnpm --filter @prospero/renderer test`
Expected: parity PASS (both files have the identical key set), 168 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/i18n
git commit -m "feat(studio): add i18n keys for agent studio redesign"
```

---

## Task 10: Docs + ROADMAP + non-regression sweep

**Files:** Create `docs/agent-studio.md`; modify `docs/m12-agent-org-definition-layer.md`, `ROADMAP.md`

- [ ] **Step 1: Full sweep**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: all CLEAN / PASS. Confirm token non-regression by inspection — `git diff <pr-f-base>..HEAD --stat` must list only `apps/renderer/**` and `docs/**` and `ROADMAP.md`; no `apps/main`, no `packages/shared`, no migration. If anything fails, STOP and report BLOCKED.

- [ ] **Step 2: Write `docs/agent-studio.md`**

Create `docs/agent-studio.md` — the M12 capstone doc. Cover: the two modes (Conversa / Estúdio) and when to use each; the six Estúdio tabs (Config, Instructions, Learning, Issues, Runs, Stats) and what each does; the `components/ui/` primitive set (`Section`, `EmptyState`, `LoadingState`, `TabBar`) and the consistency contract (`p-6`, one heading style, one empty/loading state). Mirror the tone and depth of the M11 docs (`docs/memory-architecture.md`, `docs/skills-format.md`).

- [ ] **Step 3: Update `docs/m12-agent-org-definition-layer.md`**

In §11, replace the 6-tabs-in-a-sidebar description with the final two-mode layout (Conversa / Estúdio, six full-width tabs). In §13, mark PR-F as done.

- [ ] **Step 4: Update `ROADMAP.md`**

Mark M12 PR-F done and **M12 complete** (all 6 PRs A–F), following the format used for the earlier M12 PRs — update both sections the project's roadmap-sync rule requires. Do **not** touch `docs/roadmap.html`.

- [ ] **Step 5: Commit**

```bash
git add docs ROADMAP.md
git commit -m "docs: add agent studio doc and close m12"
```

---

## Self-Review

**Spec coverage:**
- §2 two-mode architecture + §2.1 file structure → Task 2.
- §3.1 primitives + §3.3 `semantic-info` fix → Task 1.
- §3.2 consistency contract → applied in Tasks 3–8.
- §4 six-tab redesign → Tasks 3–8 (one per tab).
- §6 no data/type/migration change → honored: every task is renderer-only.
- §7 testing/non-regression → Task 10 Step 1 (full sweep, token-neutrality check) + parity in Task 9.
- §9 docs → Task 10.
- §10 phasing → matches Tasks 1–10.

**Placeholder scan:** Tasks 1, 2, 9 carry complete code. Tasks 3–8 are redesign tasks — they carry exhaustive behavior contracts + structural targets + an explicit `frontend-design` skill invocation; that delegation is mandated by spec §4/§11/§16 and is not a hand-wave. No "TBD"/"add error handling"-style gaps.

**Type consistency:** `StudioTab` is defined once in `AgentStudio.tsx` and imported by `Agent.tsx`. `TabBarTab`/`TabBar` props (`tabs`, `active`, `onSelect`, `variant`) are consistent across `Agent.tsx`, `AgentConversation.tsx`, `AgentStudio.tsx`, and the Task 5 LearningPanel use. `Mode` (`"conversa" | "estudio"`) is local to `Agent.tsx`. The six tab components keep their existing prop signatures (`ConfigTab {agent}`, `InstructionsTab {agentId}`, `LearningPanel {agentId, skills, memories}`, `IssuesTab {agentId, companyId}`, `RunsTab {agentId, companyId}`, `StatsTab {agentId}`) — Tasks 3–8 must not change them.
