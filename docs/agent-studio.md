# Agent Studio

> Documents the M12 PR-F implementation of the `/agents/:id` screen. Earlier
> versions used a 320px side panel (`AgentConfigPanel`) with tabs squeezed into
> a narrow sidebar. PR-F replaced that with a two-mode shell where the
> management surface expands to full width.

---

## Two modes: Conversa and Estúdio

`/agents/:id` renders two mutually exclusive modes controlled by a segmented
`TabBar` below the persistent header:

| Mode | When to use |
|---|---|
| **Conversa** | Day-to-day interaction — chat messages, delegation cards, tool confirmations, the composer. |
| **Estúdio** | Configuration and introspection — editing the agent's identity, instructions, skills, runs, stats. |

`mode` state lives in `apps/renderer/src/routes/Agent.tsx`. The default mode
is `"conversa"`. Switching to `"estudio"` and opening the Learning sub-tab
also happens programmatically (e.g. from the 🎓 badge in the header).

### AgentHeader (persistent)

`AgentHeader` renders above both modes and is always visible. It shows:

- Agent name, role, status badge (running / paused / terminated).
- **Mode switch** — the segmented `TabBar` (`conversa` / `estudio`) pinned
  below the header bar, rendered in `Agent.tsx`.
- 🎓 badge — skill count + memory count, tapping navigates to `estudio` →
  `learning`.
- **Assign Task** button — opens `IssueFormModal` pre-filled with this agent
  as assignee.

Source: `apps/renderer/src/components/agent-panel/AgentHeader.tsx`.

---

## Conversa mode

Rendered by `AgentConversation`. Includes the message list (streamed turns,
tool approvals, delegation cards), the composer, and the delegation composer
toggle. No structural changes in PR-F — this mode is the existing chat surface.

Source: `apps/renderer/src/components/agent-panel/AgentConversation.tsx`.

---

## Estúdio mode

Rendered by `AgentStudio`. The component owns a secondary `TabBar` (pill
variant) for the 6 tabs and delegates rendering to the active tab component.
All tabs receive `agent` as a prop; `skills` and `memories` are also threaded
down from `Agent.tsx` (fetched once per mode-switch or studio-tab-change).

Source: `apps/renderer/src/components/agent-panel/AgentStudio.tsx`.

### The 6 Estúdio tabs

#### Config

Identity, model, role template, `reports_to`, location/adapter, Run Policy
(`mode`, `always_on`, `can_hire`, `can_assign`), schedule (for always-on
agents), capabilities, and project assignments.

The Run Policy section (added in PR-E2) consolidates the two permission
toggles (`can_hire`, `can_assign`) alongside the execution-mode controls so
the full "how this agent is allowed to operate" picture is in one place.

Source: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`.

#### Instructions

The agent's **instruction bundle** — a directory on disk under
`~/.prospero/companies/<cid>/agents/<aid>/instructions/`. Displays a file
tree on the left and a markdown editor on the right. The entry file is
`charter.md` (copied from the role template at hire, editable per-agent
afterwards). Additional files can be added, reordered, or deleted; only the
entry file is protected from deletion.

Source: `apps/renderer/src/components/agent-panel/InstructionsTab.tsx`.

#### Learning

M11 tab — four sub-tabs: **Skills** (agent-private and inherited), **Memory**
(declarative facts and rules), **History** (episodic search over past
messages), and **Candidates** (derived skills awaiting review). The 🎓 badge
in the header reflects the skill + memory counts.

Source: `apps/renderer/src/components/agent-panel/LearningPanel.tsx`.

#### Issues

Issues currently assigned to this agent. Thin wrapper around the shared issue
list — filters to `assignee_id = agent.id`, full inline detail on click.

Source: `apps/renderer/src/components/agent-panel/IssuesTab.tsx`.

#### Runs

Turn history grouped by **session** (a contiguous block of turns without a
restart gap). Derived as a pure read-model from the existing `cost_events`
table — no dedicated `agent_runs` table (decision made in PR-E1). Each
session row shows start time, duration, turn count, and token total. Clicking
a session opens a drill-in panel that fetches `activity:query` for that time
window, showing individual turns with tool calls and token breakdowns.

Source: `apps/renderer/src/components/agent-panel/RunsTab.tsx`.

#### Stats

Per-agent metrics: tokens over the last 7 days (input / output / cache),
cumulative cost, and the **Budget** section (added in PR-E2). Budget shows
configured `budget_tokens_limit` / `budget_usd_limit` / `budget_period`
alongside current-period consumption as a progress bar. Enforcement mirrors
the company-level soft-stop from M8: 80% triggers an inbox warning, 100%
pauses the agent.

Source: `apps/renderer/src/components/agent-panel/StatsTab.tsx`.

---

## Shared UI primitives (`components/ui/`)

PR-F extracted four primitives used by every Estúdio tab:

| Component | Purpose |
|---|---|
| `Section` | Titled card wrapper — white background, rounded border, consistent internal spacing. Accepts `title` (string), `description` (optional string), and `children`. |
| `EmptyState` | Zero-data placeholder — centered icon + message + optional action button. Used when a tab has no data yet (no skills, no runs, etc.). |
| `LoadingState` | Spinner placeholder shown while async data is in flight. |
| `TabBar` | Horizontal tab strip in two variants: `"segmented"` (mode switch, pill style) and `"pill"` (studio sub-tabs, lighter style). |

Source: `apps/renderer/src/components/ui/`.

### Consistency contract

All six Estúdio tabs follow the same layout rules so the studio feels unified:

- **Outer padding:** `p-6` on the tab container.
- **Sections:** wrapped in `<Section title="…">` — one heading level, no raw
  `<h2>` / `<h3>` outside Section.
- **Empty states:** always `<EmptyState>` — never a raw `<p className="text-muted">`.
- **Loading states:** always `<LoadingState>` — never ad-hoc spinners.
- **Tab navigation within Estúdio:** `<TabBar variant="pill">` owned by
  `AgentStudio.tsx`, not duplicated in individual tab components.

---

## File map

```
apps/renderer/src/
├── routes/
│   └── Agent.tsx                  # two-mode shell, mode state, data fetch
├── components/
│   ├── agent-panel/
│   │   ├── AgentHeader.tsx        # persistent header + mode switch
│   │   ├── AgentConversation.tsx  # conversa mode
│   │   ├── AgentStudio.tsx        # estudio mode, tab router
│   │   ├── ConfigTab.tsx          # identity, model, run policy
│   │   ├── InstructionsTab.tsx    # instruction bundle editor
│   │   ├── LearningPanel.tsx      # M11 skills/memory/history/candidates
│   │   ├── IssuesTab.tsx          # assigned issues
│   │   ├── RunsTab.tsx            # session history + drill-in
│   │   └── StatsTab.tsx           # metrics + budget
│   └── ui/
│       ├── Section.tsx
│       ├── EmptyState.tsx
│       ├── LoadingState.tsx
│       ├── TabBar.tsx
│       └── index.ts
└── i18n/
    ├── pt-BR.json                 # keys: agent.mode.*, agent.studio.*
    └── en-US.json
```
