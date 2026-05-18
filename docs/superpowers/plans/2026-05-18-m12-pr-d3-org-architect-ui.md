# M12 PR-D3 — Org Plan Review Screen (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Org Plan Review screen — reached from the `org_proposed` inbox item — where the user reviews the CEO's proposed organization, includes/excludes roles and agents, and approves or rejects it.

**Architecture:** Mirrors the M8.5 `GoalPlanReview` pattern. A pure `orgPlanValidation` lib validates the include/exclude selection; a `useOrgPlanStore` zustand store wraps the three `org-plan:*` IPCs built in PR-D2; an `OrgPlanReview` component renders the roles/agents with checkboxes and Approve/Reject; a thin `/org-plan` route hosts it; the `org_proposed` inbox item links to that route.

**Tech Stack:** React + zustand + react-i18next, vitest. Renderer only — the backend (`org-plan:get-current` / `approve` / `reject` IPCs, `applyOrgPlan`) shipped in PR-D2.

**Spec:** `docs/superpowers/specs/2026-05-18-ceo-org-architect-design.md` §9.

**Design notes:**
- **A route, not a route-with-id.** `org-plan:get-current` returns the active company's current `proposed` plan; the inbox is already company-scoped, so `/org-plan` (no id) is enough. If the plan was superseded/decided, `getCurrent` returns null and the screen shows an empty state.
- **Reporting hierarchy is shown inline** — each agent row states who it reports to. No separate tree-widget (the spec's "small tree" is satisfied by per-agent "reports to" labels, exactly as `GoalPlanReview`'s `AgentRow` does it).
- **Reject is inline** — a reason textarea that toggles open in the component, not a separate modal (one component, less surface).
- No automated test for the component or route — the repo has no React Testing Library (prior-milestone convention). The pure validation lib and the store are tested; the component/route are typecheck- and smoke-verified.

**Targeted test runs:** `pnpm --filter @prospero/renderer exec vitest run <file>`. Full suite at the end: `pnpm test`.

---

## File Structure

**Created:**
- `apps/renderer/src/lib/orgPlanValidation.ts` — pure include/exclude validation.
- `apps/renderer/src/lib/orgPlanValidation.test.ts`
- `apps/renderer/src/stores/orgPlan.ts` — the `useOrgPlanStore` zustand store.
- `apps/renderer/src/stores/orgPlan.test.ts`
- `apps/renderer/src/components/OrgPlanReview.tsx` — the review component.
- `apps/renderer/src/routes/OrgPlan.tsx` — the `/org-plan` route page.

**Modified:**
- `apps/renderer/src/App.tsx` — register the `/org-plan` route.
- `apps/renderer/src/routes/Inbox.tsx` — `org_proposed` items get an "Open" link to `/org-plan`.
- `apps/renderer/src/i18n/en-US.json` + `pt-BR.json` — `orgPlan.*` keys.

---

## Task 1: `orgPlanValidation` lib

**Files:**
- Create: `apps/renderer/src/lib/orgPlanValidation.ts`
- Create: `apps/renderer/src/lib/orgPlanValidation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/renderer/src/lib/orgPlanValidation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { OrgPlan } from "@prospero/shared";
import { validateOrgPlanSelection, type OrgPlanFilter } from "./orgPlanValidation.js";

const plan: OrgPlan = {
  id: "orgplan_1",
  companyId: "c1",
  proposedByAgentId: "ceo",
  summary: "s",
  roles: [
    {
      index: 0,
      name: "Manager",
      description: "d",
      charter: "# c",
      model: "claude-sonnet-4-6",
      capabilities: ["chat"],
      icon: null,
    },
    {
      index: 1,
      name: "Specialist",
      description: "d",
      charter: "# c",
      model: "claude-sonnet-4-6",
      capabilities: ["chat"],
      icon: null,
    },
  ],
  agents: [
    { index: 0, name: "Ann", roleIndex: 0, reportsToIndex: "CEO", rationale: "r" },
    { index: 1, name: "Bob", roleIndex: 1, reportsToIndex: 0, rationale: "r" },
  ],
  status: "proposed",
  userFeedback: null,
  proposedAt: 0,
  decidedAt: null,
};

const all: OrgPlanFilter = {
  includedRoleIndexes: new Set([0, 1]),
  includedAgentIndexes: new Set([0, 1]),
};

describe("validateOrgPlanSelection", () => {
  it("returns no errors when everything is included", () => {
    expect(validateOrgPlanSelection(plan, all)).toEqual([]);
  });

  it("flags an included agent whose role is excluded", () => {
    const errors = validateOrgPlanSelection(plan, {
      includedRoleIndexes: new Set([0]),
      includedAgentIndexes: new Set([0, 1]),
    });
    expect(errors).toContainEqual({ kind: "agent-role-excluded", agentIndex: 1, roleIndex: 1 });
  });

  it("flags an included agent whose reports-to is excluded", () => {
    const errors = validateOrgPlanSelection(plan, {
      includedRoleIndexes: new Set([0, 1]),
      includedAgentIndexes: new Set([1]),
    });
    expect(errors).toContainEqual({
      kind: "agent-reports-to-excluded",
      agentIndex: 1,
      reportsToIndex: 0,
    });
  });

  it("ignores excluded agents", () => {
    expect(
      validateOrgPlanSelection(plan, {
        includedRoleIndexes: new Set([0]),
        includedAgentIndexes: new Set([0]),
      }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/renderer exec vitest run src/lib/orgPlanValidation.test.ts`
Expected: FAIL — `Cannot find module './orgPlanValidation.js'`.

- [ ] **Step 3: Create `apps/renderer/src/lib/orgPlanValidation.ts`**

```ts
import type { OrgPlan } from "@prospero/shared";

export type OrgPlanFilter = {
  includedRoleIndexes: Set<number>;
  includedAgentIndexes: Set<number>;
};

export type OrgPlanValidationError =
  | { kind: "agent-role-excluded"; agentIndex: number; roleIndex: number }
  | { kind: "agent-reports-to-excluded"; agentIndex: number; reportsToIndex: number };

// Validates that the include-filter selection produces an applicable org plan:
// every included agent must have its role included, and (when it reports to
// another agent rather than the CEO) its reports-to agent included. Returns the
// concrete violations so the UI can surface them and disable Approve.
export const validateOrgPlanSelection = (
  plan: OrgPlan,
  filter: OrgPlanFilter,
): OrgPlanValidationError[] => {
  const errors: OrgPlanValidationError[] = [];
  for (const agent of plan.agents) {
    if (!filter.includedAgentIndexes.has(agent.index)) continue;
    if (!filter.includedRoleIndexes.has(agent.roleIndex)) {
      errors.push({
        kind: "agent-role-excluded",
        agentIndex: agent.index,
        roleIndex: agent.roleIndex,
      });
    }
    if (
      agent.reportsToIndex !== "CEO" &&
      !filter.includedAgentIndexes.has(agent.reportsToIndex)
    ) {
      errors.push({
        kind: "agent-reports-to-excluded",
        agentIndex: agent.index,
        reportsToIndex: agent.reportsToIndex,
      });
    }
  }
  return errors;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/lib/orgPlanValidation.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/lib/orgPlanValidation.ts apps/renderer/src/lib/orgPlanValidation.test.ts
git commit -m "feat(org): add org plan selection validation"
```

---

## Task 2: `useOrgPlanStore`

**Files:**
- Create: `apps/renderer/src/stores/orgPlan.ts`
- Create: `apps/renderer/src/stores/orgPlan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/renderer/src/stores/orgPlan.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { OrgPlan } from "@prospero/shared";
import { useOrgPlanStore } from "./orgPlan.js";

const ipcMock = {
  getCurrent: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
};

const plan: OrgPlan = {
  id: "orgplan_1",
  companyId: "c1",
  proposedByAgentId: "ceo",
  summary: "s",
  roles: [],
  agents: [],
  status: "proposed",
  userFeedback: null,
  proposedAt: 0,
  decidedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: { prospero: { orgPlan: typeof ipcMock } } }).window = {
    prospero: { orgPlan: ipcMock },
  };
  useOrgPlanStore.setState({ plan: null, loaded: false });
});

describe("useOrgPlanStore", () => {
  it("load fetches the current plan", async () => {
    ipcMock.getCurrent.mockResolvedValue(plan);
    await useOrgPlanStore.getState().load();
    expect(useOrgPlanStore.getState().plan?.id).toBe("orgplan_1");
    expect(useOrgPlanStore.getState().loaded).toBe(true);
  });

  it("approve calls the IPC with the plan id and returns the result", async () => {
    useOrgPlanStore.setState({ plan, loaded: true });
    ipcMock.approve.mockResolvedValue({ ok: true, createdRoleIds: ["r"], hiredAgentIds: ["a"] });
    const result = await useOrgPlanStore.getState().approve({ includeRoleIndexes: [0] });
    expect(ipcMock.approve).toHaveBeenCalledWith({
      orgPlanId: "orgplan_1",
      includeRoleIndexes: [0],
    });
    expect(result.ok).toBe(true);
  });

  it("reject calls the IPC and clears the plan", async () => {
    useOrgPlanStore.setState({ plan, loaded: true });
    ipcMock.reject.mockResolvedValue({ ok: true });
    await useOrgPlanStore.getState().reject("not now");
    expect(ipcMock.reject).toHaveBeenCalledWith({ orgPlanId: "orgplan_1", reason: "not now" });
    expect(useOrgPlanStore.getState().plan).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/renderer exec vitest run src/stores/orgPlan.test.ts`
Expected: FAIL — `Cannot find module './orgPlan.js'`.

- [ ] **Step 3: Create `apps/renderer/src/stores/orgPlan.ts`**

```ts
import { create } from "zustand";
import type { ApplyOrgPlanResult, OrgPlan } from "@prospero/shared";

type ApproveOpts = {
  includeRoleIndexes?: number[];
  includeAgentIndexes?: number[];
};

type State = {
  plan: OrgPlan | null;
  loaded: boolean;
  load: () => Promise<void>;
  approve: (opts?: ApproveOpts) => Promise<ApplyOrgPlanResult>;
  reject: (reason?: string) => Promise<void>;
};

export const useOrgPlanStore = create<State>((set, get) => ({
  plan: null,
  loaded: false,

  load: async () => {
    const plan = await window.prospero.orgPlan.getCurrent();
    set({ plan, loaded: true });
  },

  approve: async (opts) => {
    const plan = get().plan;
    if (plan === null) throw new Error("no org plan loaded");
    const result = await window.prospero.orgPlan.approve({
      orgPlanId: plan.id,
      ...(opts?.includeRoleIndexes !== undefined
        ? { includeRoleIndexes: opts.includeRoleIndexes }
        : {}),
      ...(opts?.includeAgentIndexes !== undefined
        ? { includeAgentIndexes: opts.includeAgentIndexes }
        : {}),
    });
    if (result.ok) set({ plan: null });
    return result;
  },

  reject: async (reason) => {
    const plan = get().plan;
    if (plan === null) throw new Error("no org plan loaded");
    await window.prospero.orgPlan.reject({
      orgPlanId: plan.id,
      ...(reason !== undefined ? { reason } : {}),
    });
    set({ plan: null });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/stores/orgPlan.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/stores/orgPlan.ts apps/renderer/src/stores/orgPlan.test.ts
git commit -m "feat(org): add the org plan store"
```

---

## Task 3: `OrgPlanReview` component

**Files:**
- Create: `apps/renderer/src/components/OrgPlanReview.tsx`

No automated test (no RTL in the repo). Verified by typecheck (Step 2) and the Task 6 smoke. The validation logic is covered by Task 1.

- [ ] **Step 1: Create `apps/renderer/src/components/OrgPlanReview.tsx`**

```tsx
import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplyOrgPlanResult, OrgPlan, ProposedAgent, ProposedRole } from "@prospero/shared";
import { useOrgPlanStore } from "../stores/orgPlan.js";
import {
  validateOrgPlanSelection,
  type OrgPlanFilter,
} from "../lib/orgPlanValidation.js";

const RoleRow: FC<{
  role: ProposedRole;
  included: boolean;
  onToggle: () => void;
}> = ({ role, included, onToggle }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <li
      className={`bg-surface-card border border-surface-border rounded p-3 ${included ? "" : "opacity-50"}`}
    >
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={included} onChange={onToggle} className="w-4 h-4" />
        {role.icon !== null && <span>{role.icon}</span>}
        <span className="text-sm font-semibold text-brand-dark">{role.name}</span>
        <span className="text-xs text-ink-muted">· {role.model}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-xs text-brand hover:underline"
        >
          {expanded ? t("orgPlan.collapse") : t("orgPlan.viewCharter")}
        </button>
      </div>
      <p className="text-xs text-ink-muted mt-1 pl-7">{role.description}</p>
      {expanded && (
        <pre className="mt-2 ml-7 p-2 bg-surface-soft rounded text-[11px] whitespace-pre-wrap font-mono">
          {role.charter}
        </pre>
      )}
    </li>
  );
};

const AgentRow: FC<{
  agent: ProposedAgent;
  roleName: string;
  reportsToLabel: string;
  included: boolean;
  onToggle: () => void;
}> = ({ agent, roleName, reportsToLabel, included, onToggle }) => {
  const { t } = useTranslation();
  return (
    <li
      className={`bg-surface-card border border-surface-border rounded p-3 ${included ? "" : "opacity-50"}`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <input type="checkbox" checked={included} onChange={onToggle} className="w-4 h-4" />
        <span className="text-sm font-semibold text-brand-dark">{agent.name}</span>
        <span className="text-xs text-ink-muted">· {roleName}</span>
        <span className="text-xs text-ink-muted">
          · {t("orgPlan.reportsTo")} {reportsToLabel}
        </span>
      </div>
      <p className="text-xs text-ink-muted mt-1 pl-7">{agent.rationale}</p>
    </li>
  );
};

export const OrgPlanReview: FC<{ plan: OrgPlan }> = ({ plan }) => {
  const { t } = useTranslation();
  const approve = useOrgPlanStore((s) => s.approve);
  const reject = useOrgPlanStore((s) => s.reject);

  const [included, setIncluded] = useState<OrgPlanFilter>(() => ({
    includedRoleIndexes: new Set(plan.roles.map((r) => r.index)),
    includedAgentIndexes: new Set(plan.agents.map((a) => a.index)),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyOrgPlanResult | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const roleName = useMemo(() => {
    const m = new Map(plan.roles.map((r) => [r.index, r.name]));
    return (idx: number): string => m.get(idx) ?? `#${idx}`;
  }, [plan.roles]);

  const agentName = useMemo(() => {
    const m = new Map(plan.agents.map((a) => [a.index, a.name]));
    return (idx: number): string => m.get(idx) ?? `#${idx}`;
  }, [plan.agents]);

  const errors = useMemo(
    () => validateOrgPlanSelection(plan, included),
    [plan, included],
  );

  const toggleRole = (idx: number): void =>
    setIncluded((cur) => {
      const next = new Set(cur.includedRoleIndexes);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...cur, includedRoleIndexes: next };
    });

  const toggleAgent = (idx: number): void =>
    setIncluded((cur) => {
      const next = new Set(cur.includedAgentIndexes);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...cur, includedAgentIndexes: next };
    });

  const handleApprove = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const opts: { includeRoleIndexes?: number[]; includeAgentIndexes?: number[] } = {};
      if (included.includedRoleIndexes.size < plan.roles.length) {
        opts.includeRoleIndexes = [...included.includedRoleIndexes];
      }
      if (included.includedAgentIndexes.size < plan.agents.length) {
        opts.includeAgentIndexes = [...included.includedAgentIndexes];
      }
      const res = await approve(opts);
      setResult(res);
      if (!res.ok) setError(`${res.failedAtStep}: ${res.error}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await reject(rejectReason.trim() === "" ? undefined : rejectReason.trim());
      setResult({ ok: true, createdRoleIds: [], hiredAgentIds: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (result !== null && result.ok) {
    return (
      <div className="bg-surface-card border border-surface-border rounded p-6 text-sm">
        <p className="font-semibold text-semantic-success">{t("orgPlan.applied.title")}</p>
        <p className="text-ink-muted mt-1">
          {t("orgPlan.applied.detail", {
            roles: result.createdRoleIds.length,
            agents: result.hiredAgentIds.length,
          })}
        </p>
      </div>
    );
  }

  const approveDisabled = submitting || errors.length > 0;

  return (
    <div className="bg-surface-card border border-surface-border rounded">
      <section className="p-4 border-b border-surface-border">
        <h2 className="text-sm font-semibold text-brand-dark mb-2">{t("orgPlan.title")}</h2>
        <p className="text-sm text-ink whitespace-pre-wrap">{plan.summary}</p>
      </section>

      <section className="p-4 border-b border-surface-border">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-soft mb-2">
          {t("orgPlan.roles", { count: plan.roles.length })}
        </h3>
        <ul className="space-y-2">
          {plan.roles.map((r) => (
            <RoleRow
              key={r.index}
              role={r}
              included={included.includedRoleIndexes.has(r.index)}
              onToggle={() => toggleRole(r.index)}
            />
          ))}
        </ul>
      </section>

      <section className="p-4 border-b border-surface-border">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-soft mb-2">
          {t("orgPlan.agents", { count: plan.agents.length })}
        </h3>
        <ul className="space-y-2">
          {plan.agents.map((a) => (
            <AgentRow
              key={a.index}
              agent={a}
              roleName={roleName(a.roleIndex)}
              reportsToLabel={a.reportsToIndex === "CEO" ? "CEO" : agentName(a.reportsToIndex)}
              included={included.includedAgentIndexes.has(a.index)}
              onToggle={() => toggleAgent(a.index)}
            />
          ))}
        </ul>
      </section>

      {errors.length > 0 && (
        <section className="p-4 border-b border-surface-border bg-semantic-danger/5">
          <ul className="text-xs text-semantic-danger space-y-1">
            {errors.map((e, i) => (
              <li key={i}>
                {e.kind === "agent-role-excluded"
                  ? t("orgPlan.validation.agentRoleExcluded", {
                      agent: agentName(e.agentIndex),
                      role: roleName(e.roleIndex),
                    })
                  : t("orgPlan.validation.agentReportsToExcluded", {
                      agent: agentName(e.agentIndex),
                      parent: agentName(e.reportsToIndex),
                    })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="p-4 flex gap-3 flex-wrap items-start">
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={approveDisabled}
          className="px-4 py-2 bg-semantic-success text-white text-sm rounded font-semibold disabled:opacity-50"
        >
          {submitting ? t("orgPlan.approving") : t("orgPlan.approve")}
        </button>
        <button
          type="button"
          onClick={() => setShowReject((v) => !v)}
          disabled={submitting}
          className="px-4 py-2 bg-semantic-danger text-white text-sm rounded font-semibold disabled:opacity-50"
        >
          {t("orgPlan.reject")}
        </button>
        {error !== null && <p className="basis-full text-sm text-semantic-danger">{error}</p>}
        {showReject && (
          <div className="basis-full mt-2 space-y-2">
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              placeholder={t("orgPlan.rejectReasonPlaceholder")}
              className="w-full px-2 py-1.5 border border-surface-border rounded bg-surface text-xs"
            />
            <button
              type="button"
              onClick={() => void handleReject()}
              disabled={submitting}
              className="text-xs px-3 py-1.5 bg-semantic-danger text-white rounded font-semibold disabled:opacity-50"
            >
              {t("orgPlan.confirmReject")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck the renderer**

Run: `pnpm --filter @prospero/renderer run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/OrgPlanReview.tsx
git commit -m "feat(org): add the org plan review component"
```

---

## Task 4: The `/org-plan` route + inbox link

**Files:**
- Create: `apps/renderer/src/routes/OrgPlan.tsx`
- Modify: `apps/renderer/src/App.tsx`
- Modify: `apps/renderer/src/routes/Inbox.tsx`

No automated test — verified by typecheck (Step 4) and the Task 6 smoke.

- [ ] **Step 1: Create `apps/renderer/src/routes/OrgPlan.tsx`**

```tsx
import { useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useOrgPlanStore } from "../stores/orgPlan.js";
import { OrgPlanReview } from "../components/OrgPlanReview.js";

export const OrgPlan: FC = () => {
  const { t } = useTranslation();
  const plan = useOrgPlanStore((s) => s.plan);
  const loaded = useOrgPlanStore((s) => s.loaded);
  const load = useOrgPlanStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-4">{t("orgPlan.pageTitle")}</h1>
      {!loaded ? (
        <p className="text-sm text-ink-muted">…</p>
      ) : plan === null ? (
        <p className="text-sm text-ink-muted">{t("orgPlan.none")}</p>
      ) : (
        <OrgPlanReview plan={plan} />
      )}
    </div>
  );
};
```

- [ ] **Step 2: Register the route in `App.tsx`**

In `apps/renderer/src/App.tsx`, add the import next to the other route imports (near the `Agent as AgentRoute` import):

```ts
import { OrgPlan } from "./routes/OrgPlan.js";
```

Then add a `<Route>` block alongside the others (e.g. after the `/inbox` route block) — match the exact shape of the neighbouring routes, including the `hasToken` guard and `<Layout>`:

```tsx
          <Route
            path="/org-plan"
            element={
              hasToken ? (
                <Layout>
                  <OrgPlan />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
```

(If the neighbouring routes wrap the element in `<Suspense>` for lazy-loaded pages, `OrgPlan` here is a plain eager import — no `Suspense` needed, mirroring the eager `AgentRoute` import.)

- [ ] **Step 3: Link the `org_proposed` inbox item to the route**

In `apps/renderer/src/routes/Inbox.tsx`, find the `GOAL_KINDS.includes(item.kind) && (() => { ... })()` block that renders the "Open goal" link. Immediately after that block (still inside the `<li>`), add an `org_proposed` link:

```tsx
              {item.kind === "org_proposed" && (
                <Link
                  to="/org-plan"
                  onClick={() => {
                    if (item.readAt === null) void markRead(item.id);
                  }}
                  className="text-xs text-brand hover:underline font-semibold mt-2 inline-block"
                >
                  {t("inbox.openOrgPlan")} →
                </Link>
              )}
```

(`Link` and `markRead` are already imported/used in `Inbox.tsx`.)

- [ ] **Step 4: Typecheck the renderer**

Run: `pnpm --filter @prospero/renderer run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/routes/OrgPlan.tsx apps/renderer/src/App.tsx apps/renderer/src/routes/Inbox.tsx
git commit -m "feat(org): add the org plan route and inbox link"
```

---

## Task 5: i18n keys

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

The `parity.test.ts` enforces identical key sets — that is this task's check.

- [ ] **Step 1: Add the `orgPlan` block + `inbox.openOrgPlan` to `en-US.json`**

In `apps/renderer/src/i18n/en-US.json`, add an `inbox.openOrgPlan` key inside the existing `inbox` object (next to `openGoal`):

```json
    "openOrgPlan": "Open org plan",
```

Then add a new top-level `orgPlan` object (place it after the `goals` object):

```json
  "orgPlan": {
    "pageTitle": "Organization design",
    "none": "No organization design is awaiting review.",
    "title": "Proposed organization",
    "roles": "Roles ({{count}})",
    "agents": "Agents ({{count}})",
    "viewCharter": "View charter",
    "collapse": "Collapse",
    "reportsTo": "reports to",
    "approve": "Approve & create",
    "approving": "Creating…",
    "reject": "Reject",
    "confirmReject": "Confirm reject",
    "rejectReasonPlaceholder": "Optional — why are you rejecting this?",
    "applied": {
      "title": "Organization created.",
      "detail": "{{roles}} role(s) and {{agents}} agent(s) were created."
    },
    "validation": {
      "agentRoleExcluded": "{{agent}} is included but its role {{role}} is excluded.",
      "agentReportsToExcluded": "{{agent}} reports to {{parent}}, which is excluded."
    }
  },
```

- [ ] **Step 2: Add the same keys to `pt-BR.json`**

In `apps/renderer/src/i18n/pt-BR.json`, add `inbox.openOrgPlan` inside the `inbox` object:

```json
    "openOrgPlan": "Abrir proposta de organização",
```

Then the `orgPlan` object after `goals`:

```json
  "orgPlan": {
    "pageTitle": "Projeto da organização",
    "none": "Nenhuma proposta de organização aguardando revisão.",
    "title": "Organização proposta",
    "roles": "Papéis ({{count}})",
    "agents": "Agentes ({{count}})",
    "viewCharter": "Ver charter",
    "collapse": "Recolher",
    "reportsTo": "reporta a",
    "approve": "Aprovar e criar",
    "approving": "Criando…",
    "reject": "Rejeitar",
    "confirmReject": "Confirmar rejeição",
    "rejectReasonPlaceholder": "Opcional — por que está rejeitando?",
    "applied": {
      "title": "Organização criada.",
      "detail": "{{roles}} papel(éis) e {{agents}} agente(s) criados."
    },
    "validation": {
      "agentRoleExcluded": "{{agent}} está incluído mas o papel {{role}} está excluído.",
      "agentReportsToExcluded": "{{agent}} reporta a {{parent}}, que está excluído."
    }
  },
```

- [ ] **Step 3: Run the i18n parity test**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS. If it reports a key mismatch, align the two `orgPlan` blocks and the `inbox.openOrgPlan` key.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(org): add i18n keys for the org plan review"
```

---

## Task 6: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: every package exits 0.

- [ ] **Step 2: Lint the whole workspace**

Run: `pnpm lint`
Expected: every package exits 0.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all packages green. New tests: `orgPlanValidation.test.ts` (4), `orgPlan.test.ts` (3). Expect roughly **1289 passing + 2 todo** (baseline 1282 + 7), no regressions.

- [ ] **Step 4: Manual smoke (record the result, do not skip)**

With a Claude credential configured, run `pnpm dev`:
1. Ask the CEO in chat to "design a small traffic agency".
2. Open the Inbox — the `org_proposed` item shows an "Open org plan" link.
3. Click it → the `/org-plan` screen lists the proposed roles (with a "View
   charter" expand) and agents (with their role and reports-to).
4. Uncheck a role → the agent in it shows a validation error and Approve is
   disabled; re-check it.
5. Click "Approve & create" → the success panel reports the created counts;
   the new roles appear in `/roles` and the new agents in `/org`.
6. Re-run, and this time use Reject with a reason → the plan clears.

Record the smoke result in the commit/PR notes.

- [ ] **Step 5: Final commit (only if smoke surfaced fixes)**

```bash
git add -A
git commit -m "fix(org): address org plan review smoke findings"
```

---

## Self-Review Notes

- **Spec coverage (spec §9):** "modeled on `GoalPlanReview`, reached by clicking the `org_proposed` inbox item" → Task 4 (route + inbox link). "Summary" → Task 3 summary section. "Roles list — include/exclude, name, model, capabilities, charter preview" → Task 3 `RoleRow`. "Agents list — include/exclude, name, role, reports-to, rationale" → Task 3 `AgentRow`. "reporting hierarchy as a small tree" → satisfied inline via per-agent reports-to labels (noted in the header). "Approve / Reject; Approve disabled while the include selection is invalid" → Task 3 + Task 1 validation.
- **Type consistency:** `OrgPlanFilter` / `OrgPlanValidationError` defined in Task 1, consumed in Task 3. `useOrgPlanStore`'s `approve`/`reject`/`load` signatures (Task 2) match the calls in Task 3 and the route in Task 4. The `window.prospero.orgPlan.*` shape matches the `env.d.ts` types shipped in PR-D2.
- **Out of scope:** the backend (`org-plan:*` IPCs, `applyOrgPlan`) shipped in PR-D2; a dedicated nav entry (the screen is reached from the inbox).
- **No placeholder scan hits.** Every code step shows complete code.
