# M9 PR-B — Dashboard Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/dashboard` route stub with a real grid of 7 widgets (Active Agents, Active Issues, Inbox unread, Costs Today, Active Agents Panel, Goals Progress, Recent Activity).

**Architecture:** Each widget is a small functional component in `apps/renderer/src/components/dashboard/`. They read from existing zustand stores (agents/issues/inbox/goals) and the existing `useCostsToday` and `useActivityStream` hooks. Selectors with non-trivial filtering are extracted to `lib/dashboard/selectors.ts` (pure functions, vitest-testable). No new IPC or migration.

**Tech Stack:** React 18, zustand, react-i18next, Tailwind grid, vitest.

---

## File map

**Create:**
- `apps/renderer/src/components/dashboard/ActiveAgentsWidget.tsx`
- `apps/renderer/src/components/dashboard/ActiveIssuesWidget.tsx`
- `apps/renderer/src/components/dashboard/InboxUnreadWidget.tsx`
- `apps/renderer/src/components/dashboard/ActiveAgentsPanelWidget.tsx`
- `apps/renderer/src/components/dashboard/GoalsProgressWidget.tsx`
- `apps/renderer/src/components/dashboard/RecentActivityWidget.tsx`
- `apps/renderer/src/lib/dashboard/selectors.ts` — pure filter/sort helpers
- `apps/renderer/src/lib/dashboard/selectors.test.ts`

**Modify:**
- `apps/renderer/src/components/costs/CostsTodayWidget.tsx` — keep at current path (already imported widely); no move needed
- `apps/renderer/src/routes/Dashboard.tsx` — replace stub with grid + widgets
- `apps/renderer/src/i18n/pt-BR.json` + `en-US.json` — ~20 keys novas em `dashboard.*`
- `apps/renderer/src/i18n/parity.test.ts` — extend assertions

> **Note on CostsTodayWidget**: spec mentioned moving it to `components/dashboard/`. Skipping the rename — it lives in `components/costs/` and is imported there. Moving creates churn without value. Leave it; just import from existing path in the new Dashboard.

---

## Task 1: Selectors (pure functions)

**Files:**
- Create: `apps/renderer/src/lib/dashboard/selectors.ts`
- Create: `apps/renderer/src/lib/dashboard/selectors.test.ts`

- [ ] **Step 1.1: Write failing tests**

Create `apps/renderer/src/lib/dashboard/selectors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Agent, Issue, Goal } from "@dashboard-agent/shared";
import {
  selectActiveAgents,
  selectActiveIssues,
  countIssuesByProject,
  selectInProgressGoals,
} from "./selectors.js";

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "ag",
  companyId: "co",
  name: "A",
  role: "r",
  systemPrompt: "p",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  skills: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  ...over,
});

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: "is",
  identifier: "X-1",
  companyId: "co",
  projectId: null,
  parentId: null,
  title: "T",
  description: null,
  assigneeId: null,
  status: "todo",
  priority: "medium",
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g",
  companyId: "co",
  title: "T",
  description: null,
  level: "company",
  status: "draft",
  parentGoalId: null,
  ownerAgentId: null,
  budgetMaxTokens: null,
  deadline: null,
  successCriteria: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("selectActiveAgents", () => {
  it("includes thinking, working, waiting; excludes idle/paused/terminated/error", () => {
    const agents = [
      agent({ id: "a1", status: "thinking" }),
      agent({ id: "a2", status: "working" }),
      agent({ id: "a3", status: "waiting" }),
      agent({ id: "a4", status: "idle" }),
      agent({ id: "a5", status: "paused" }),
      agent({ id: "a6", status: "terminated" }),
      agent({ id: "a7", status: "error" }),
    ];
    const result = selectActiveAgents(agents);
    expect(result.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("selectActiveIssues", () => {
  it("includes doing + review only", () => {
    const issues = [
      issue({ id: "i1", status: "doing" }),
      issue({ id: "i2", status: "review" }),
      issue({ id: "i3", status: "done" }),
      issue({ id: "i4", status: "todo" }),
      issue({ id: "i5", status: "backlog" }),
      issue({ id: "i6", status: "cancelled" }),
    ];
    const result = selectActiveIssues(issues);
    expect(result.map((i) => i.id).sort()).toEqual(["i1", "i2"]);
  });
});

describe("countIssuesByProject", () => {
  it("counts active issues grouped by projectId; null is its own bucket", () => {
    const issues = [
      issue({ id: "i1", status: "doing", projectId: "p1" }),
      issue({ id: "i2", status: "doing", projectId: "p1" }),
      issue({ id: "i3", status: "review", projectId: "p2" }),
      issue({ id: "i4", status: "done", projectId: "p1" }),
      issue({ id: "i5", status: "doing", projectId: null }),
    ];
    const counts = countIssuesByProject(selectActiveIssues(issues));
    expect(counts).toEqual({ p1: 2, p2: 1, "": 1 });
  });
});

describe("selectInProgressGoals", () => {
  it("returns goals with status in_progress, sorted by updatedAt desc, top 3", () => {
    const goals = [
      goal({ id: "g1", status: "in_progress", updatedAt: 100 }),
      goal({ id: "g2", status: "in_progress", updatedAt: 200 }),
      goal({ id: "g3", status: "in_progress", updatedAt: 50 }),
      goal({ id: "g4", status: "in_progress", updatedAt: 300 }),
      goal({ id: "g5", status: "achieved", updatedAt: 999 }),
      goal({ id: "g6", status: "draft", updatedAt: 999 }),
    ];
    const result = selectInProgressGoals(goals, 3);
    expect(result.map((g) => g.id)).toEqual(["g4", "g2", "g1"]);
  });
});
```

Run: `pnpm --filter @dashboard-agent/renderer test -- "lib/dashboard/selectors"`. Expected FAIL.

- [ ] **Step 1.2: Implement selectors**

Create `apps/renderer/src/lib/dashboard/selectors.ts`:

```typescript
import type { Agent, Issue, Goal } from "@dashboard-agent/shared";

const ACTIVE_AGENT_STATUSES = new Set(["thinking", "working", "waiting"]);
const ACTIVE_ISSUE_STATUSES = new Set(["doing", "review"]);

export const selectActiveAgents = (agents: Agent[]): Agent[] =>
  agents.filter((a) => ACTIVE_AGENT_STATUSES.has(a.status));

export const selectActiveIssues = (issues: Issue[]): Issue[] =>
  issues.filter((i) => ACTIVE_ISSUE_STATUSES.has(i.status));

export const countIssuesByProject = (issues: Issue[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const i of issues) {
    const key = i.projectId ?? "";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

export const selectInProgressGoals = (goals: Goal[], limit: number): Goal[] =>
  goals
    .filter((g) => g.status === "in_progress")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
```

Run again. Expected PASS.

- [ ] **Step 1.3: Commit**

```bash
git add apps/renderer/src/lib/dashboard/selectors.ts apps/renderer/src/lib/dashboard/selectors.test.ts
git commit -m "feat(m9): dashboard selector helpers (active agents/issues, goals progress)"
```

---

## Task 2: ActiveAgentsWidget

**Files:**
- Create: `apps/renderer/src/components/dashboard/ActiveAgentsWidget.tsx`

- [ ] **Step 2.1: Implement**

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../../stores/agents.js";
import { selectActiveAgents } from "../../lib/dashboard/selectors.js";

const STATUS_COLOR: Record<string, string> = {
  thinking: "bg-brand",
  working: "bg-semantic-success",
  waiting: "bg-semantic-warning",
};

export const ActiveAgentsWidget: FC = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const active = selectActiveAgents(agents);
  const top = active.slice(0, 3);

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.activeAgents.title")}
        </h3>
        <span className="text-xl font-bold text-brand-dark">{active.length}</span>
      </div>
      {active.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.activeAgents.empty")}</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {top.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[a.status] ?? "bg-ink-soft"}`}
              />
              <Link to={`/agents/${a.id}`} className="truncate text-ink hover:text-brand">
                {a.name}
              </Link>
              <span className="text-ink-soft text-[10px] uppercase">{a.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 2.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/dashboard/ActiveAgentsWidget.tsx
git commit -m "feat(m9): ActiveAgentsWidget — count + top 3 with status dot"
```

---

## Task 3: ActiveIssuesWidget

**Files:**
- Create: `apps/renderer/src/components/dashboard/ActiveIssuesWidget.tsx`

- [ ] **Step 3.1: Implement**

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useIssuesStore } from "../../stores/issues.js";
import { useProjectsStore } from "../../stores/projects.js";
import { selectActiveIssues, countIssuesByProject } from "../../lib/dashboard/selectors.js";

export const ActiveIssuesWidget: FC = () => {
  const { t } = useTranslation();
  const issues = useIssuesStore((s) => s.issues);
  const projects = useProjectsStore((s) => s.projects);
  const active = selectActiveIssues(issues);
  const counts = countIssuesByProject(active);
  const projectsById = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.activeIssues.title")}
        </h3>
        <Link to="/issues" className="text-xs text-brand hover:underline">
          {t("dashboard.activeIssues.viewAll")} →
        </Link>
      </div>
      {active.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.activeIssues.empty")}</p>
      ) : (
        <>
          <div className="text-3xl font-bold text-brand-dark">{active.length}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {t("dashboard.activeIssues.subtitle")}
          </div>
          <ul className="mt-3 space-y-1 text-xs">
            {Object.entries(counts).map(([projectId, n]) => (
              <li key={projectId} className="flex justify-between">
                <span className="text-ink truncate">
                  {projectId === "" ? t("dashboard.activeIssues.noProject") : (projectsById.get(projectId) ?? projectId)}
                </span>
                <span className="text-ink-soft">{n}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 3.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/dashboard/ActiveIssuesWidget.tsx
git commit -m "feat(m9): ActiveIssuesWidget — count + breakdown por project"
```

---

## Task 4: InboxUnreadWidget

**Files:**
- Create: `apps/renderer/src/components/dashboard/InboxUnreadWidget.tsx`

- [ ] **Step 4.1: Implement**

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useInboxStore } from "../../stores/inbox.js";

export const InboxUnreadWidget: FC = () => {
  const { t } = useTranslation();
  const items = useInboxStore((s) => s.items);
  const unread = useInboxStore((s) => s.unread);
  const lastUnread = items.find((i) => i.readAt === null) ?? null;

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.inboxUnread.title")}
        </h3>
        <Link to="/inbox" className="text-xs text-brand hover:underline">
          {t("dashboard.inboxUnread.viewAll")} →
        </Link>
      </div>
      {unread === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.inboxUnread.empty")}</p>
      ) : (
        <>
          <div className="text-3xl font-bold text-brand-dark">{unread}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {t("dashboard.inboxUnread.subtitle")}
          </div>
          {lastUnread !== null && (
            <p className="mt-3 text-xs text-ink truncate" title={lastUnread.title}>
              {t("dashboard.inboxUnread.latestLabel")}: {lastUnread.title}
            </p>
          )}
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 4.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/dashboard/InboxUnreadWidget.tsx
git commit -m "feat(m9): InboxUnreadWidget — count + latest unread snippet"
```

---

## Task 5: ActiveAgentsPanelWidget

**Files:**
- Create: `apps/renderer/src/components/dashboard/ActiveAgentsPanelWidget.tsx`

- [ ] **Step 5.1: Implement**

This widget is granular — shows each active agent + their `currentAction`.

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../../stores/agents.js";
import { selectActiveAgents } from "../../lib/dashboard/selectors.js";

const STATUS_COLOR: Record<string, string> = {
  thinking: "bg-brand",
  working: "bg-semantic-success",
  waiting: "bg-semantic-warning",
};

export const ActiveAgentsPanelWidget: FC = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const active = selectActiveAgents(agents);

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">
        {t("dashboard.activePanel.title")}
      </h3>
      {active.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.activePanel.empty")}</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {active.map((a) => {
            const showAction =
              a.currentAction !== null && a.currentAction !== "";
            return (
              <li key={a.id} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[a.status] ?? "bg-ink-soft"}`}
                  />
                  <Link to={`/agents/${a.id}`} className="text-ink hover:text-brand">
                    {a.name}
                  </Link>
                  <span className="text-ink-soft text-[10px] uppercase">{a.status}</span>
                </span>
                {showAction && (
                  <span className="pl-3.5 text-[11px] italic text-ink-soft truncate">
                    {a.currentAction}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 5.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/dashboard/ActiveAgentsPanelWidget.tsx
git commit -m "feat(m9): ActiveAgentsPanelWidget — per-agent status + currentAction"
```

---

## Task 6: GoalsProgressWidget

**Files:**
- Create: `apps/renderer/src/components/dashboard/GoalsProgressWidget.tsx`

- [ ] **Step 6.1: Implement**

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useGoalsStore } from "../../stores/goals.js";
import { selectInProgressGoals } from "../../lib/dashboard/selectors.js";

export const GoalsProgressWidget: FC = () => {
  const { t } = useTranslation();
  const goals = useGoalsStore((s) => s.goals);
  const top = selectInProgressGoals(goals, 3);

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.goals.title")}
        </h3>
        <Link to="/goals" className="text-xs text-brand hover:underline">
          {t("dashboard.goals.viewAll")} →
        </Link>
      </div>
      {top.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.goals.empty")}</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {top.map((g) => (
            <li key={g.id}>
              <Link
                to={`/goals/${g.id}`}
                className="block truncate text-ink hover:text-brand"
                title={g.title}
              >
                {g.title}
              </Link>
              <span className="text-[10px] text-ink-soft uppercase tracking-wide">
                {t(`goals.status.${g.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

> **Note about `goals.status.*` keys:** these already exist from M8.5 PR-B. If `t()` returns the raw key (no fallback), confirm with `grep "goals.status" apps/renderer/src/i18n/pt-BR.json`. If missing, add them in Task 9 (i18n).

- [ ] **Step 6.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/dashboard/GoalsProgressWidget.tsx
git commit -m "feat(m9): GoalsProgressWidget — top 3 in_progress goals"
```

---

## Task 7: RecentActivityWidget

**Files:**
- Create: `apps/renderer/src/components/dashboard/RecentActivityWidget.tsx`

- [ ] **Step 7.1: Implement**

Reuses existing `useActivityStream` (M7.7) but slices to 10 and renders compact rows.

```tsx
import type { FC } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../../stores/agents.js";
import { useActivityStream } from "../../hooks/useActivityStream.js";
import { renderDescription, type Lookups } from "../activity/activityRender.js";
import { useRelativeTime } from "../../hooks/useRelativeTime.js";
import type { ActivityEventRow, ActorKind } from "@dashboard-agent/shared";

const DOT_COLOR: Record<ActorKind, string> = {
  user: "bg-brand",
  agent: "bg-semantic-success",
  system: "bg-ink-soft",
};

type RowProps = { row: ActivityEventRow; lookups: Lookups };

const Row: FC<RowProps> = ({ row, lookups }) => {
  const { t } = useTranslation();
  const time = useRelativeTime(row.createdAt);
  const description = renderDescription(row, t, lookups);
  return (
    <li className="flex items-start gap-3 py-2 border-b border-surface-border last:border-b-0">
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${DOT_COLOR[row.actorKind]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-ink truncate">{description}</p>
        <p className="text-[10px] text-ink-soft">{time}</p>
      </div>
    </li>
  );
};

type Props = { companyId: string };

export const RecentActivityWidget: FC<Props> = ({ companyId }) => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const { rows, loading } = useActivityStream(companyId, {});
  const top = rows.slice(0, 10);

  const lookups: Lookups = useMemo(
    () => ({
      agentsById: new Map(agents.map((a) => [a.id, a.name])),
      currentUserName: t("activity.user.you"),
      systemName: t("activity.system.name"),
    }),
    [agents, t],
  );

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.recentActivity.title")}
        </h3>
        <Link to="/activity" className="text-xs text-brand hover:underline">
          {t("dashboard.recentActivity.viewAll")} →
        </Link>
      </div>
      {loading && rows.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.recentActivity.loading")}</p>
      ) : top.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.recentActivity.empty")}</p>
      ) : (
        <ul>
          {top.map((r) => (
            <Row key={r.id} row={r} lookups={lookups} />
          ))}
        </ul>
      )}
    </div>
  );
};
```

> **i18n note:** `activity.user.you` and `activity.system.name` already exist from M7.7. If missing in either locale, add in Task 9.

- [ ] **Step 7.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/dashboard/RecentActivityWidget.tsx
git commit -m "feat(m9): RecentActivityWidget — last 10 events with live subscribe"
```

---

## Task 8: Dashboard.tsx layout integration

**Files:**
- Modify: `apps/renderer/src/routes/Dashboard.tsx`

- [ ] **Step 8.1: Replace the route file**

Replace the entire content of `apps/renderer/src/routes/Dashboard.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { useCompaniesStore } from "../stores/companies.js";
import { CostsTodayWidget } from "../components/costs/CostsTodayWidget.js";
import { ActiveAgentsWidget } from "../components/dashboard/ActiveAgentsWidget.js";
import { ActiveIssuesWidget } from "../components/dashboard/ActiveIssuesWidget.js";
import { InboxUnreadWidget } from "../components/dashboard/InboxUnreadWidget.js";
import { ActiveAgentsPanelWidget } from "../components/dashboard/ActiveAgentsPanelWidget.js";
import { GoalsProgressWidget } from "../components/dashboard/GoalsProgressWidget.js";
import { RecentActivityWidget } from "../components/dashboard/RecentActivityWidget.js";

export const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const loadAgents = useAgentsStore((s) => s.load);
  const companyId = useCompaniesStore((s) => s.activeId);

  const onCreateDemo = async () => {
    const company = await window.dashboardAgent.companies.createDemo();
    await useCompaniesStore.getState().load();
    await useCompaniesStore.getState().setActive(company.id);
    await loadAgents(company.id);
    const updated = useAgentsStore.getState().agents;
    if (updated.length > 0) navigate(`/agents/${updated[0]!.id}`);
  };

  if (companyId === null) {
    return (
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">{t("app.title")}</h1>
          <p className="text-ink-muted mt-2">{t("dashboard.emptyCompany")}</p>
        </div>
        <button
          onClick={() => void onCreateDemo()}
          className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded"
          type="button"
        >
          {t("dashboard.createDemoCompany")}
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{t("dashboard.title")}</h1>

      {agents.length === 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-5">
          <p className="text-sm text-ink-muted mb-3">{t("dashboard.noAgentsHint")}</p>
          <button
            onClick={() => void onCreateDemo()}
            className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded"
            type="button"
          >
            {t("dashboard.createDemoCompany")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActiveAgentsWidget />
        <ActiveIssuesWidget />
        <InboxUnreadWidget />
        <CostsTodayWidget companyId={companyId} />
        <ActiveAgentsPanelWidget />
        <GoalsProgressWidget />
      </div>

      <RecentActivityWidget companyId={companyId} />
    </div>
  );
};
```

- [ ] **Step 8.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/routes/Dashboard.tsx
git commit -m "feat(m9): dashboard layout — 2-col grid + recent activity full-width"
```

---

## Task 9: i18n keys + parity

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 9.1: Add PT-BR keys**

In `apps/renderer/src/i18n/pt-BR.json`, find the `"dashboard":` block (~line 206). Replace it with:

```json
"dashboard": {
  "title": "Dashboard",
  "placeholder": "Dashboard ainda é stub. Widgets (Recent Activity, Active Agents, métricas) chegam em M9 — Custos hoje já funciona via M8.",
  "emptyCompany": "Crie ou selecione uma empresa pra ver o dashboard.",
  "noAgentsHint": "Sem agentes ainda. Crie uma empresa de demonstração pra testar.",
  "createDemoCompany": "Criar empresa de demonstração",
  "activeAgents": {
    "title": "Agentes ativos",
    "empty": "Nenhum agente em ação agora."
  },
  "activeIssues": {
    "title": "Issues em andamento",
    "subtitle": "Doing + Review",
    "viewAll": "Ver todas",
    "empty": "Sem issues em andamento.",
    "noProject": "Sem project"
  },
  "inboxUnread": {
    "title": "Inbox",
    "subtitle": "não lidos",
    "viewAll": "Abrir inbox",
    "empty": "Inbox limpa ✓",
    "latestLabel": "Último"
  },
  "activePanel": {
    "title": "Painel de agentes ativos",
    "empty": "Ninguém em ação."
  },
  "goals": {
    "title": "Objetivos em andamento",
    "viewAll": "Ver todos",
    "empty": "Nenhum objetivo em andamento."
  },
  "recentActivity": {
    "title": "Atividade recente",
    "viewAll": "Ver tudo",
    "empty": "Sem atividade recente.",
    "loading": "Carregando…"
  },
  "costsToday": {
    "title": "Custos hoje",
    "viewDetails": "Ver detalhes →",
    "tokens": "tokens",
    "noActivity": "Sem atividade hoje."
  }
}
```

> **Note:** Preserve any keys under `dashboard.costsToday.*` already in the file — the block above keeps them (`title`, `viewDetails`, `tokens`, `noActivity`). If your existing file has extra keys, merge instead of overwriting.

- [ ] **Step 9.2: Mirror in EN-US**

Replace the `"dashboard":` block in `apps/renderer/src/i18n/en-US.json`:

```json
"dashboard": {
  "title": "Dashboard",
  "placeholder": "Dashboard is still a stub. Widgets land in M9 — Costs today is live via M8.",
  "emptyCompany": "Create or select a company to see the dashboard.",
  "noAgentsHint": "No agents yet. Create a demo company to try it out.",
  "createDemoCompany": "Create demo company",
  "activeAgents": {
    "title": "Active agents",
    "empty": "No agents in action."
  },
  "activeIssues": {
    "title": "Active issues",
    "subtitle": "Doing + Review",
    "viewAll": "View all",
    "empty": "No active issues.",
    "noProject": "No project"
  },
  "inboxUnread": {
    "title": "Inbox",
    "subtitle": "unread",
    "viewAll": "Open inbox",
    "empty": "Inbox clear ✓",
    "latestLabel": "Latest"
  },
  "activePanel": {
    "title": "Active agents panel",
    "empty": "Nobody in action."
  },
  "goals": {
    "title": "Goals in progress",
    "viewAll": "View all",
    "empty": "No goals in progress."
  },
  "recentActivity": {
    "title": "Recent activity",
    "viewAll": "View all",
    "empty": "No recent activity.",
    "loading": "Loading…"
  },
  "costsToday": {
    "title": "Costs today",
    "viewDetails": "View details →",
    "tokens": "tokens",
    "noActivity": "No activity today."
  }
}
```

- [ ] **Step 9.3: Verify activity.user.you + activity.system.name + goals.status.* exist in both locales**

```bash
grep -E 'activity.user|activity.system|"goals":' apps/renderer/src/i18n/pt-BR.json | head -5
grep -E 'activity.user|activity.system|"goals":' apps/renderer/src/i18n/en-US.json | head -5
```

If `goals.status.in_progress` / `activity.user.you` etc. are missing in either locale, add them. These were created in M8.5/M7.7 — should already exist.

- [ ] **Step 9.4: Extend parity test**

Edit `apps/renderer/src/i18n/parity.test.ts`. Add a new `it()` block:

```typescript
it("includes the M9 PR-B dashboard widget keys in both locales", () => {
  const ptKeys = flatten(ptBR);
  const enKeys = flatten(enUS);
  for (const k of [
    "dashboard.title",
    "dashboard.emptyCompany",
    "dashboard.activeAgents.title",
    "dashboard.activeAgents.empty",
    "dashboard.activeIssues.title",
    "dashboard.activeIssues.viewAll",
    "dashboard.inboxUnread.title",
    "dashboard.inboxUnread.empty",
    "dashboard.activePanel.title",
    "dashboard.activePanel.empty",
    "dashboard.goals.title",
    "dashboard.goals.viewAll",
    "dashboard.recentActivity.title",
    "dashboard.recentActivity.empty",
  ]) {
    expect(ptKeys).toContain(k);
    expect(enKeys).toContain(k);
  }
});
```

Run: `pnpm --filter @dashboard-agent/renderer test -- parity`. Expected PASS (bidirectional + new).

- [ ] **Step 9.5: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m9): i18n keys for dashboard widgets (pt-BR + en-US)"
```

---

## Task 10: Full suite verification

- [ ] **Step 10.1: Run everything**

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

Expected counts: 758 + ~5 new (4 selector tests + 1 parity assertion) = **~763**.

> **If anything fails:** typecheck errors from missing i18n keys, type mismatches between Issue / Goal types — fix inline. Don't continue to T11 until green.

---

## Task 11: Roadmap update (3 lugares)

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/roadmap.html`

- [ ] **Step 11.1: ROADMAP.md §M9 Dashboard checkboxes**

In `ROADMAP.md` find the §M9 Dashboard widgets block (~line 728). Check off:

```diff
- [ ] **Dashboard widgets:** (consume Activity stream do M7.7)
+ [x] **Dashboard widgets:** ✅ **PR-B mergeado 2026-05-14** (consume Activity stream do M7.7)
  - [x] Agentes Ativos (count + lista mini)
  - [x] Issues em Andamento (count Doing+Review por project)
  - [x] Inbox unread (count + último item)
  - [x] Custos Hoje (tokens + % Max — alimenta de M8) — reuso direto
  - [x] **Recent Activity** (últimos 10 eventos de `activity_events` com live subscribe)
  - [x] **Active Agents Panel** (per-agent status com `currentAction` granular)
  - [x] Goals em andamento (top 3 in_progress)
```

In "Em linguagem simples" (~line 113):

```diff
- 📈 **Dashboard inicial com widgets dinâmicos** — Agentes ativos / Issues em andamento / Inbox / Custos hoje → M9 PR-B
+ 📈 **Dashboard inicial com widgets dinâmicos** ✅ M9 PR-B (2026-05-14)
```

In "v1 scope tracker" Dashboard row (~line 193):

```diff
- | **Dashboard** | 🟡 Stub | Rota `/dashboard` existe (placeholder M2). Widgets §6.4 + Recent Activity + Active Agents **NÃO** (M9 consome Activity stream do M7.7). |
+ | **Dashboard** | ✅ Completo | M9 PR-B (2026-05-14): 7 widgets em grid 2-col + Recent Activity full-width. Active Agents / Active Issues / Inbox unread / Costs today / Active Agents Panel / Goals Progress / Recent Activity (10 eventos live). |
```

- [ ] **Step 11.2: roadmap.html 3 seções**

Edit `docs/roadmap.html`:

1. **/00 layperson "O que ainda NÃO funciona"** — remove the line about dashboard widgets (it now works).
2. **/01 progress** — bump test count to ~763, update "agora" card to "M9 PR-B mergeado", list remaining PRs (C/E/F).
3. **/03 módulos** — find the M9 article. Mark "Dashboard widgets" feature group ✅ with the PR-B date. Find the "Dashboard" module status — flip from stub to completo.

(Match the pattern used in `88ee039` (PR-A closure) and `ddb44a8` (PR-D closure). Read the file to find the exact anchors before editing.)

- [ ] **Step 11.3: Commit**

```bash
git add ROADMAP.md docs/roadmap.html
git commit -m "docs(m9): close pr-b dashboard widgets in roadmap (3 places)"
```

---

## Task 12: Memory snippet + handoff

**Files:**
- Create: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_m9_pr_b_lessons.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\MEMORY.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_session_handoff.md`

- [ ] **Step 12.1: Write lessons memory**

Content sketch:

```markdown
---
name: project-m9-pr-b-lessons
description: "M9 PR-B Dashboard widgets mergeado 2026-05-14. ~12 commits, +5 testes (763 total). 6 widgets novos em components/dashboard/ + reuso CostsTodayWidget existente. Selectors puros em lib/dashboard/. Lições: reuso useActivityStream sliced, CostsTodayWidget não move (evita churn), grid 2-col responsivo md+."
metadata:
  type: project
---

# M9 PR-B — Dashboard widgets (mergeado 2026-05-14)

## Decisões
- CostsTodayWidget mantido em `components/costs/` (spec sugeria mover; mover viraria churn em imports sem ganho).
- Selectors puros em `lib/dashboard/selectors.ts` — testáveis sem RTL, todos os filtros (active agents/issues, counts, in-progress goals) extraídos.
- RecentActivityWidget reusa `useActivityStream({})` existente e faz `.slice(0, 10)` em vez de criar IPC novo `activity:listByCompany` (que era proposto no spec mas seria redundante).
- GoalsProgressWidget: sem % de progresso por goal (issues não têm `goal_id` no type do Issue ainda — M8.5 PR-A schema apenas). Mostra título + status. YAGNI.
- Active company null → CTA full-page; senão grid + widgets.

## Lições
1. **Existing useActivityStream funciona pro widget** — não foi preciso criar hook ou IPC novo. Slice(0, 10) no consumer. 50 fetched, 10 mostrados — desperdício é mínimo single-user.
2. **md:grid-cols-2** — grid responsivo Tailwind. Em telas < 768px vira coluna única; ≥768px vira 2-col. Eletron desktop alvo é ≥1024, então sempre 2-col na prática.
3. **selectInProgressGoals sort desc por updatedAt** — top 3. Goals com mais atividade recente sobem.
4. **Vazio per widget é diferente** — cada widget tem seu próprio empty state. CostsTodayWidget reusa o existente.

## Status final
- 13/14 milestones do v1; M9 com 3/6 PRs (A + D + B)
- 763 testes passing
- Próximo: **M9 PR-C — /agents list + Settings defaults**. Spec §7.
```

- [ ] **Step 12.2: Update MEMORY.md index**

Add line after PR-D entry:

```markdown
- [M9 PR-B lições — Dashboard widgets](project_m9_pr_b_lessons.md) — mergeado 2026-05-14, 6 widgets novos + selectors puros em lib/dashboard/. Reuso useActivityStream sliced; CostsTodayWidget não movido.
```

- [ ] **Step 12.3: Update session_handoff**

Bump HEAD, test count to 763, "M9 com 3/6 PRs", próximo PR-C.

---

## Self-review checklist

- [x] **Spec coverage:** §6 of design covers 6-widget grid + RecentActivity full-width. All 7 widgets in plan (6 novos + CostsTodayWidget reusado). Layout matches (2-col grid + last full-width).
- [x] **Placeholder scan:** every step has actual code. No "TBD".
- [x] **Type consistency:** `Agent`/`Issue`/`Goal` shapes match shared types. Selector helpers reused across widgets.
- [x] **No new IPC / migration:** confirmed. PR-B is renderer-only.

If something diverges during execution, fix inline and add to T12 lessons.
