# CEO Org Architect — Design

> **Status:** design spec (2026-05-18). Base for **M12 PR-D2** (backend) and **PR-D3** (UI).
>
> **Sources:** [docs/m12-agent-org-definition-layer.md](../../m12-agent-org-definition-layer.md) §4.4 · brainstorm 2026-05-18 · the M8.5 goal-plan machinery (`apps/main/src/goals/`, `apps/main/src/mcp/tools-goals.ts`, `apps/renderer/src/components/GoalPlanReview.tsx`) · PR-A role library (`role-templates-repository.ts`, `role-charter-store.ts`) · PR-D1 charter generation.

---

## 1. TL;DR

The CEO can design the whole company from a one-line request. The user tells the
CEO in chat — "set up a traffic agency" — and the CEO proposes a complete
organization: the **roles** that should exist (each with a full 8-section
charter), the **agents** to hire into them, and the **reporting hierarchy**. The
proposal lands in the inbox; the user reviews it, includes/excludes parts, and
approves. Approval creates the roles and hires the agents in one transaction.

This mirrors the M8.5 goal-plan pattern (`submit_goal_plan` → review → execute)
but for organizational **structure** rather than goal **work**.

---

## 2. Scope

**In scope** — roles, agents, and the reporting hierarchy.

**Out of scope:**
- **Projects** — a project needs a real filesystem path on the user's disk; the
  CEO cannot know those. The user adds projects separately.
- **Issues** — issues come from the goal-plan flow (M8.5), not from org design.
- **A "Design company" wizard** — the trigger is a plain chat message to the
  CEO. A dedicated wizard UI is possible future polish.
- **"Request changes" with free-text feedback** — the review has only Approve
  and Reject. To iterate, the user rejects and asks the CEO again in chat.

**Non-destructive:** an org plan only ever **creates** roles and agents. It
never edits or deletes existing ones. The review screen's include/exclude lets
the user trim the proposal before applying.

---

## 3. Flow

```
User → chat → CEO:  "set up a traffic agency"
  CEO (has the org-architect capability) calls submit_org_plan({...})
    → validates payload (zod + DAG + per-charter sanitizer)
    → inserts an org_plans row (status 'proposed'); supersedes any prior 'proposed' plan
    → creates an `org_proposed` inbox item pointing at the plan
User → opens the inbox item → Org Plan Review screen
    → include/exclude roles & agents → Approve  (or Reject with a reason)
  Approve → applyOrgPlan(): one transaction, two passes
    → pass 1: create each included role (role_templates row + charter file on disk)
    → pass 2: topo-sort included agents by reportsTo; create each agent in its
              role; wire the hierarchy
    → mark the plan 'approved'
```

---

## 4. Data model

### 4.1 New table `org_plans`

Migration `M12-PR-D2` (next sequential number after the M12 PR-A migration
`0024`). A single table — unlike goals there is no persistent parent entity, an
org plan is a one-shot proposal.

```sql
CREATE TABLE org_plans (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  proposed_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  summary              TEXT NOT NULL,
  roles_json           TEXT NOT NULL,
  agents_json          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'proposed'
                         CHECK (status IN ('proposed','approved','rejected','superseded')),
  user_feedback        TEXT,
  proposed_at          INTEGER NOT NULL,
  decided_at           INTEGER
);
CREATE INDEX idx_org_plans_company_status ON org_plans(company_id, status);
```

The same migration also adds the `org_proposed` inbox kind — recreating
`inbox_items` with the expanded `kind` CHECK, the established pattern from
migrations 0019–0022 (`PRAGMA defer_foreign_keys`, copy, drop, rename).

### 4.2 Payload shapes (`roles_json` / `agents_json`)

```ts
type ProposedRole = {
  index: number;           // 1-based, unique within the plan
  name: string;
  description: string;     // one line
  charter: string;         // full 8-section markdown, written by the CEO
  model: string;           // a Claude model id
  capabilities: string[];  // capability ids
  icon: string | null;
};

type ProposedAgent = {
  index: number;                       // 1-based, unique within the plan
  name: string;
  roleIndex: number;                   // → a ProposedRole.index
  reportsToIndex: number | "CEO";      // → a ProposedAgent.index, or the existing CEO
  rationale: string;                   // why this hire — shown in the review
};
```

These mirror the index-based model of `AgentToHire` / `IssueToCreate` in the
goal plan: the CEO refers to not-yet-created entities by index; the executor
resolves indexes to real ids.

A shared `OrgPlan` type (renderer-facing, camelCase) is added to
`packages/shared/src/types/` alongside the goal-plan types.

---

## 5. `submit_org_plan` MCP tool

A new tool, registered in the MCP layer next to `submit_goal_plan`, gated by the
`org-architect` capability.

**Input:** `{ summary: string, roles: ProposedRole[], agents: ProposedAgent[] }`.

**Validation** (`OrgPlanPayloadSchema`, zod, in `apps/main/src/schemas/`):
- ≥ 1 role, ≥ 1 agent.
- Role `index` values unique; agent `index` values unique.
- Every `agent.roleIndex` references an existing role index.
- Every `agent.reportsToIndex` is `"CEO"` or an existing agent index.
- The `reportsTo` graph is acyclic (DAG check, like the goal plan's).
- Each role's `charter` is non-empty.
- **Each charter passes `sanitizeMemoryBody`** — the charters are LLM output, so
  this is defense-in-depth against prompt injection (design doc §12). A failing
  charter rejects the whole submission with a clear error.

**Effect:** inserts an `org_plans` row (`status = 'proposed'`); if the company
already has a `proposed` plan, marks it `superseded`; creates an `org_proposed`
inbox item with `payloadJson = { orgPlanId }`. Returns `{ orgPlanId }`.

---

## 6. The `org-architect` capability

A new capability id `org-architect` in `CAPABILITY_CATALOG`
(`packages/shared/src/capabilities.ts`) that resolves to the
`mcp__dashboard__submit_org_plan` tool.

Granted to the CEO three ways so both new and existing companies get it:
- Added to the `role-ceo` seed role template's default capabilities.
- A post-migration adds `org-architect` to the `capabilities_json` of every
  existing agent whose role is CEO.
- (New CEOs hired from the CEO role template inherit it from the template.)

---

## 7. `applyOrgPlan` executor

`apps/main/src/orchestrator/` or `apps/main/src/agents/` — a new
`apply-org-plan.ts`. On approval, in a single `db.transaction`:

**Pass 1 — roles.** For each *included* role: create a `role_templates` row via
the PR-A `role-templates-repository.create`, then write its charter to disk via
`role-charter-store.writeCharter`. Record the proposed-index → created-role-id map.

**Pass 2 — agents.** Topologically sort the *included* agents by
`reportsToIndex` (parent before child — reuse the `topoSortAgents` approach from
`goals/executor.ts`). For each: create the agent (`agentsRepo.create`) with
`templateId` = the created role's id, `role` = the role name,
`capabilities`/`model` from the role; then wire `reportsTo` to the resolved
parent agent id (or the existing company CEO for `"CEO"`).

Mark the plan `approved`, record an activity event, return
`{ ok: true, createdRoleIds, hiredAgentIds }` or
`{ ok: false, error, failedAtStep }` — the `ExecutePlanResult` shape.

**Include/exclude rules** (validated in the review before approve is enabled):
- Excluding a role excludes every agent in that role.
- If an agent's `reportsTo` target is excluded, that agent must also be excluded
  (or the review flags it). No silent re-parenting.

---

## 8. IPC

Three handlers, mirroring the goals IPCs:
- `org-plan:get-current` — the current `proposed` plan for the active company,
  or null.
- `org-plan:approve` — `{ orgPlanId, includeRoleIndexes?, includeAgentIndexes? }`
  → runs `applyOrgPlan`, returns the `ExecutePlanResult`.
- `org-plan:reject` — `{ orgPlanId, reason? }` → marks the plan `rejected`,
  stores `user_feedback`.

---

## 9. Review screen (PR-D3)

A component modeled on `GoalPlanReview` (`apps/renderer/src/components/`),
reached by clicking the `org_proposed` inbox item:
- Summary text.
- Roles list — each row include/exclude checkbox, name, model, capabilities,
  and an expand to preview the charter.
- Agents list — each row include/exclude, name, its role, who it reports to,
  rationale.
- The reporting hierarchy as a small tree.
- **Approve** and **Reject** (reason modal) buttons; Approve disabled while the
  include selection is invalid (orphaned `reportsTo`, role with no agents kept,
  etc.).

Exact information architecture is the `frontend-design` skill's call at PR-D3
implementation time.

---

## 10. Build split

- **PR-D2 (backend):** the `org_plans` migration + `org_proposed` inbox kind,
  the `org_plans` repository, `OrgPlanPayloadSchema`, the `submit_org_plan` MCP
  tool, the `org-architect` capability + its post-migration, the `applyOrgPlan`
  executor, and the three IPC handlers. Verified by unit/integration tests
  (payload validation, DAG check, executor two-pass round-trip, supersede).
- **PR-D3 (UI):** the Org Plan Review screen, the renderer store, inbox
  wiring, i18n.

This split mirrors M8.5 (Goals: PR-A backend, PR-B UI).

---

## 11. Security

- `submit_org_plan` is gated by the `org-architect` capability (CEO-only).
- Every proposed charter passes `sanitizeMemoryBody` at submit time — LLM output
  treated as an injection vector (design doc §12).
- No hire happens without explicit user approval in the review screen.
- The org plan is **purely additive** — it cannot edit or delete existing roles
  or agents, so a malicious or buggy proposal cannot destroy company state.
- `applyOrgPlan` runs in a single transaction — a partial failure rolls back
  cleanly, leaving no half-built org.

---

## 12. Testing

- Unit: `OrgPlanPayloadSchema` accepts a valid plan, rejects duplicate indexes,
  dangling `roleIndex`/`reportsToIndex`, and a hierarchy cycle.
- Unit: charter sanitizer rejection blocks the whole submission.
- Integration: `submit_org_plan` inserts a plan + inbox item; a second submit
  supersedes the first.
- Integration: `applyOrgPlan` round-trip — approve a plan, assert the roles
  exist with charters on disk, the agents exist in their roles with the
  hierarchy wired; the transaction rolls back on an induced failure.
- Integration: include/exclude — excluding a role+its agents applies the subset.
- Non-regression: the M8.5 goal-plan flow is untouched; the security suite stays
  green.

---

## 13. Open items deferred

- A dedicated "Design company" wizard (richer discovery than a chat message).
- "Request changes" with structured feedback (vs. reject-and-re-ask).
- Org-plan versioning history (each submit currently supersedes the prior).
