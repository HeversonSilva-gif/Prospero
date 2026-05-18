# M11 PR-E2 — Memory derivation + Org Learnings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the ascending memory flow — when a goal is achieved the system derives a company **retrospective** memory, and when the user rejects an agent's action it derives a **preference** memory — and surface what the company has learned in an "Org Learnings" dashboard card.

**Architecture:** Two new derivation triggers extend the PR-D engine. `jobForActivity` detects `goal.status_changed→achieved` and `approval.rejected`; the worker grows a second output path: instead of a `skill_candidate` (review-gated), the goal/approval triggers write a `memory` row directly (sanitized, not human-reviewed — they are facts, not procedures). A goal retrospective is company-scoped (`agentId: null`, `kind: "retrospective"`) and files a `goal_retrospective_ready` inbox notice; a preference is agent-scoped (`kind: "preference"`). An "Org Learnings" dashboard card reads company-shared skills + recent retrospectives via a new IPC.

**Tech Stack:** TypeScript, better-sqlite3, Electron IPC, React, react-i18next, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md` §2.2-2.4, §7, §10, §11 PR-E.

## Decisions locked for this plan

- **PR-E2 is the memory-derivation half of PR-E** (PR-E1 shipped the skill flow). PR-E2 = the `goal.achieved`→retrospective and `approval.rejected`→preference triggers + the `goal_retrospective_ready` inbox + the `/dashboard` "Org Learnings" card.
- **The terminate-modal "promote private skills?" flow is deferred to PR-F.** Its "non-promoted skills → cascade soft-delete with a 30-day TTL" needs a TTL/expiry mechanism — that is a decay/maintenance concern and PR-F owns decay/maintenance. PR-E2 stays focused on the derivation triggers + visibility.
- **Memory derivations are NOT human-reviewed.** Skills go through `skill_candidate` review (a procedure an agent will follow needs sign-off); a retrospective/preference is a recorded fact — it is sanitized (§9 — derivation is untrusted LLM output) and written directly. The `goal_retrospective_ready` inbox item is a *notification* (`requiresAction: false`), not an approval gate. This matches spec §7's pipeline (step 7: "memory kind=retrospective → company scope → inbox; memory kind=preference → agent scope" — no review step).
- **Only `approval.rejected` triggers the preference derivation.** Spec §2.3/§2.4 also name "issue regression by the user" as a second preference signal — that is deferred (a secondary, fuzzier signal; `approval.rejected` is the clean unambiguous one).
- **The derivation cap keys on the activity's `agentId`.** For `goal_achieved` that is the CEO (who marked the goal achieved); for `approval_rejected` it is the approval's agent. The retrospective's cost_event counts against the CEO's daily budget — consistent with PR-D1's per-agent cap, no new company-budget concept.
- **The worker routes by trigger:** `issue_done`/`recovery` → `skill_candidate` (the existing path); `goal_achieved`/`approval_rejected` → `memory`. A separate `parseMemoryDerivation` parses the memory output (just a `body`, no name/description).

## File structure

| File | Responsibility |
|---|---|
| `apps/main/src/db/migrations/0021_inbox_goal_retrospective_kind.sql` | inbox `kind` += `goal_retrospective_ready` |
| `packages/shared/src/types/inbox.ts` (modify) | add `goal_retrospective_ready` |
| `apps/renderer/src/routes/Inbox.tsx` (modify) | `KIND_BORDER` + `GOAL_KINDS` entry |
| `apps/main/src/derivation/worker.ts` (modify) | `DerivationJob` triggers + memory output path |
| `apps/main/src/derivation/dispatcher.ts` (modify) | `jobForActivity` — 2 new triggers |
| `apps/main/src/derivation/trail.ts` (modify) | `buildGoalTrail`, `buildApprovalTrail` |
| `apps/main/src/derivation/prompts.ts` (modify) | `buildRetrospectivePrompt`, `buildPreferencePrompt` |
| `apps/main/src/derivation/parse-output.ts` (modify) | `parseMemoryDerivation` |
| `packages/shared/src/ipc-channels.ts` (modify) | `LEARNING_ORG` channel |
| `apps/main/src/ipc/learning-handlers.ts` (modify) | `orgLearnings` handler |
| `apps/main/src/ipc/preload.ts` + `apps/renderer/src/env.d.ts` (modify) | `learning.orgLearnings` bridge |
| `apps/renderer/src/components/dashboard/OrgLearningsWidget.tsx` | the dashboard card |
| `apps/renderer/src/routes/Dashboard.tsx` (modify) | add the widget to the grid |
| `apps/renderer/src/i18n/{pt-BR,en-US}.json` + `parity.test.ts` (modify) | widget i18n |

Dependencies: Task 1 independent. Tasks 2-5 are the engine (2 trails, 3 prompts/parse, 4 worker, 5 dispatcher) — 2/3 independent, 4 depends on 1+2+3, 5 depends on 4. Task 6 depends on nothing new. Task 7 depends on 6. Task 8 depends on 7.

---

## Task 1: Inbox kind `goal_retrospective_ready`

A derived retrospective files an inbox notice. SQLite cannot alter a CHECK in place — recreate `inbox_items` (the `0019`/`0020` pattern).

**Files:**
- Create: `apps/main/src/db/migrations/0021_inbox_goal_retrospective_kind.sql`
- Modify: `packages/shared/src/types/inbox.ts`
- Modify: `apps/renderer/src/routes/Inbox.tsx`
- Create: `apps/main/tests/migration.0021-inbox-goal-retrospective.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/tests/migration.0021-inbox-goal-retrospective.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

describe("migration 0021 — inbox goal_retrospective_ready kind", () => {
  it("accepts an inbox item with kind goal_retrospective_ready", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb1','c1','goal_retrospective_ready','Retrospective',0,0)`,
    ).run();
    const row = db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb1'").get() as {
      kind: string;
    };
    expect(row.kind).toBe("goal_retrospective_ready");
  });

  it("still accepts the prior skill_promotion_requested kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb2','c1','skill_promotion_requested','x',1,0)`,
    ).run();
    expect(
      (db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb2'").get() as { kind: string }).kind,
    ).toBe("skill_promotion_requested");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/migration.0021-inbox-goal-retrospective.test.ts`
Expected: FAIL — the `goal_retrospective_ready` insert throws a CHECK-constraint error.

- [ ] **Step 3: Create the migration**

Create `apps/main/src/db/migrations/0021_inbox_goal_retrospective_kind.sql`:

```sql
-- M11 PR-E: extend inbox_items.kind CHECK constraint to allow goal_retrospective_ready.
--
-- SQLite cannot ALTER a CHECK constraint in place — recreate the table with
-- the expanded set. defer_foreign_keys so the FK on actor_id->agents.id stays
-- valid during the swap.

PRAGMA defer_foreign_keys = 1;

CREATE TABLE inbox_items_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'approval',
      'completed',
      'suggestion',
      'error',
      'security_alert',
      'goal_proposed',
      'goal_executing',
      'goal_error',
      'agent_unresponsive',
      'skill_candidate_pending',
      'skill_promotion_requested',
      'goal_retrospective_ready'
    )),
  actor_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,
  requires_action INTEGER NOT NULL DEFAULT 0
    CHECK (requires_action IN (0,1)),
  approval_id TEXT REFERENCES approvals(id) ON DELETE SET NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

INSERT INTO inbox_items_new
  (id, company_id, kind, actor_id, title, preview, payload_json,
   requires_action, approval_id, read_at, created_at)
SELECT
  id, company_id, kind, actor_id, title, preview, payload_json,
  requires_action, approval_id, read_at, created_at
FROM inbox_items;

DROP TABLE inbox_items;
ALTER TABLE inbox_items_new RENAME TO inbox_items;
```

- [ ] **Step 4: Add the kind to the shared type**

In `packages/shared/src/types/inbox.ts`, add `| "goal_retrospective_ready"` to the `InboxKind` union, after `"skill_promotion_requested"`.

- [ ] **Step 5: Add the renderer entries**

In `apps/renderer/src/routes/Inbox.tsx`:
- Add to the `KIND_BORDER` map (next to the other skill/goal entries):
```typescript
  goal_retrospective_ready: "border-l-4 border-l-brand",
```
- Find the `GOAL_KINDS` array (the kinds that render an "open goal" link via `extractGoalId`). Add `"goal_retrospective_ready"` to it — the retrospective inbox item carries `{goalId}` in its payload, so it should get the same "open goal" link.

- [ ] **Step 6: Run the test + typecheck**

Run: `pnpm --filter @prospero/main exec vitest run tests/migration.0021-inbox-goal-retrospective.test.ts`
Expected: PASS (2 tests)

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/db/migrations/0021_inbox_goal_retrospective_kind.sql packages/shared/src/types/inbox.ts apps/renderer/src/routes/Inbox.tsx apps/main/tests/migration.0021-inbox-goal-retrospective.test.ts
git commit -m "feat(m11): add goal_retrospective_ready inbox kind"
```

---

## Task 2: Goal & approval trails

Two trail assemblers — `buildGoalTrail` (the achieved goal + its issues) and `buildApprovalTrail` (the rejected approval + the user's reason).

**Files:**
- Modify: `apps/main/src/derivation/trail.ts`
- Modify: `apps/main/src/derivation/trail.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/main/src/derivation/trail.test.ts`, add this `describe` block (the file already has an in-memory-DB `seed`-style setup from PR-D1 — read it and reuse its DB-building helper; if it builds the db inline per test, follow that style):

```typescript
import { buildGoalTrail, buildApprovalTrail } from "./trail.js";

describe("buildGoalTrail", () => {
  it("returns the goal with its issues", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO goals (id, company_id, title, description, level, status, success_criteria, created_at, updated_at)
       VALUES ('g1','c1','Ship the redis fix','make it reliable','task','achieved','no flakes',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO issues (id, company_id, title, description, status, priority, goal_id, created_at, updated_at)
       VALUES ('i1','c1','Raise the pool','d','done','high','g1',0,0),
              ('i2','c1','Add a retry','d','done','medium','g1',0,0)`,
    ).run();
    const trail = buildGoalTrail(db, "g1");
    expect(trail?.title).toBe("Ship the redis fix");
    expect(trail?.successCriteria).toBe("no flakes");
    expect(trail?.issues.map((i) => i.title)).toEqual(["Raise the pool", "Add a retry"]);
  });

  it("returns null for an unknown goal", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(buildGoalTrail(db, "nope")).toBeNull();
  });
});

describe("buildApprovalTrail", () => {
  it("returns the approval kind, payload, and the user's rejection note", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
         allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO approvals (id, agent_id, kind, payload_json, status, decided_by, decision_note, created_at, resolved_at)
       VALUES ('ap1','a1','tool_call','{"tool":"Bash"}','rejected','user','do not force-push',0,0)`,
    ).run();
    const trail = buildApprovalTrail(db, "ap1");
    expect(trail?.kind).toBe("tool_call");
    expect(trail?.payloadJson).toBe('{"tool":"Bash"}');
    expect(trail?.note).toBe("do not force-push");
  });

  it("returns null for an unknown approval", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(buildApprovalTrail(db, "nope")).toBeNull();
  });
});
```

> Match the test file's existing import style — `Database`, `applyMigrations` are already imported there. If the file builds the DB through a shared helper, use it; the inline DB above is self-contained and will work regardless.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/trail.test.ts`
Expected: FAIL — `buildGoalTrail` / `buildApprovalTrail` are not exported.

- [ ] **Step 3: Add the trails**

In `apps/main/src/derivation/trail.ts`, append:

```typescript
export type GoalTrail = {
  title: string;
  description: string;
  successCriteria: string;
  issues: Array<{ title: string; status: string }>;
};

type GoalRow = { title: string; description: string | null; success_criteria: string | null };
type GoalIssueRow = { title: string; status: string };

// Assembles the trail for a `goal.achieved` retrospective: the goal plus the
// issues that were created under it. Returns null if the goal is gone.
export const buildGoalTrail = (db: Database.Database, goalId: string): GoalTrail | null => {
  const goal = db
    .prepare("SELECT title, description, success_criteria FROM goals WHERE id = ?")
    .get(goalId) as GoalRow | undefined;
  if (goal === undefined) return null;
  const issues = db
    .prepare("SELECT title, status FROM issues WHERE goal_id = ? ORDER BY created_at ASC")
    .all(goalId) as GoalIssueRow[];
  return {
    title: goal.title,
    description: goal.description ?? "",
    successCriteria: goal.success_criteria ?? "",
    issues,
  };
};

export type ApprovalTrail = { kind: string; payloadJson: string; note: string };

type ApprovalRow = { kind: string; payload_json: string; decision_note: string | null };

// Assembles the trail for an `approval.rejected` preference derivation: what
// the agent asked to do and why the user said no. Returns null if gone.
export const buildApprovalTrail = (
  db: Database.Database,
  approvalId: string,
): ApprovalTrail | null => {
  const a = db
    .prepare("SELECT kind, payload_json, decision_note FROM approvals WHERE id = ?")
    .get(approvalId) as ApprovalRow | undefined;
  if (a === undefined) return null;
  return { kind: a.kind, payloadJson: a.payload_json, note: a.decision_note ?? "" };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/trail.test.ts`
Expected: PASS — the existing trail tests plus the 4 new ones.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS

```bash
git add apps/main/src/derivation/trail.ts apps/main/src/derivation/trail.test.ts
git commit -m "feat(m11): add goal and approval derivation trails"
```

---

## Task 3: Memory prompts + `parseMemoryDerivation`

The retrospective/preference prompts and a parser for their output (a memory body — no name/description).

**Files:**
- Modify: `apps/main/src/derivation/prompts.ts`
- Modify: `apps/main/src/derivation/parse-output.ts`
- Modify: `apps/main/src/derivation/parse-output.test.ts`
- Modify: `apps/main/src/derivation/trail.test.ts` (a prompt assertion — see Step 5)

- [ ] **Step 1: Write the failing parser test**

In `apps/main/src/derivation/parse-output.test.ts`, add this `describe` block:

```typescript
import { parseMemoryDerivation } from "./parse-output.js";

describe("parseMemoryDerivation", () => {
  it("parses a fenced JSON memory block", () => {
    const text = 'Here:\n```json\n{"body":"the staging deploy uses docker compose"}\n```';
    expect(parseMemoryDerivation(text)).toEqual({
      kind: "memory",
      body: "the staging deploy uses docker compose",
    });
  });

  it("treats a bare DISCARD as a discard", () => {
    expect(parseMemoryDerivation("DISCARD")).toEqual({ kind: "discard" });
  });

  it("treats output with no JSON block as a discard", () => {
    expect(parseMemoryDerivation("nothing reusable here")).toEqual({ kind: "discard" });
  });

  it("treats a block with an empty body as a discard", () => {
    expect(parseMemoryDerivation('```json\n{"body":""}\n```')).toEqual({ kind: "discard" });
  });

  it("treats malformed JSON as a discard", () => {
    expect(parseMemoryDerivation("```json\n{not json}\n```")).toEqual({ kind: "discard" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/parse-output.test.ts`
Expected: FAIL — `parseMemoryDerivation` is not exported.

- [ ] **Step 3: Add `parseMemoryDerivation`**

In `apps/main/src/derivation/parse-output.ts`, append (the file already has the `JSON_BLOCK` regex):

```typescript
// A memory fragment extracted from a goal/approval derivation. Unlike a skill,
// a memory is just a body — no name/description.
export type ParsedMemory = { kind: "memory"; body: string } | { kind: "discard" };

// Parses the runner's output for a memory derivation (retrospective /
// preference). Anything that is not a well-formed JSON block with a non-empty
// `body` — including the literal "DISCARD" — is a discard. Never throws.
export const parseMemoryDerivation = (text: string): ParsedMemory => {
  const match = JSON_BLOCK.exec(text);
  if (match === null) return { kind: "discard" };
  const inner = match[1];
  if (inner === undefined) return { kind: "discard" };
  let obj: unknown;
  try {
    obj = JSON.parse(inner.trim());
  } catch {
    return { kind: "discard" };
  }
  if (typeof obj !== "object" || obj === null) return { kind: "discard" };
  const raw = (obj as Record<string, unknown>)["body"];
  const body = typeof raw === "string" ? raw.trim() : "";
  if (body === "") return { kind: "discard" };
  return { kind: "memory", body };
};
```

- [ ] **Step 4: Run the parser test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/parse-output.test.ts`
Expected: PASS (the existing skill-parser tests + 5 new)

- [ ] **Step 5: Write the failing prompt test**

In `apps/main/src/derivation/trail.test.ts` (where the existing prompt tests live), add:

```typescript
import { buildRetrospectivePrompt, buildPreferencePrompt } from "./prompts.js";

describe("memory prompts", () => {
  it("buildRetrospectivePrompt embeds the goal and asks for DISCARD-or-JSON", () => {
    const p = buildRetrospectivePrompt({
      title: "Ship the redis fix",
      description: "make it reliable",
      successCriteria: "no flakes",
      issues: [{ title: "Raise the pool", status: "done" }],
    });
    expect(p).toContain("Ship the redis fix");
    expect(p).toContain("Raise the pool");
    expect(p).toContain("DISCARD");
    expect(p).toContain("```json");
  });

  it("buildPreferencePrompt embeds the rejected action and the note", () => {
    const p = buildPreferencePrompt({
      kind: "tool_call",
      payloadJson: '{"tool":"Bash"}',
      note: "do not force-push",
    });
    expect(p).toContain("do not force-push");
    expect(p).toContain("DISCARD");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/trail.test.ts`
Expected: FAIL — `buildRetrospectivePrompt` / `buildPreferencePrompt` are not exported.

- [ ] **Step 7: Add the memory prompts**

In `apps/main/src/derivation/prompts.ts`:

- Add the `GoalTrail` / `ApprovalTrail` imports to the existing `./trail.js` import:
```typescript
import type { IssueTrail, RecoveryTrail, GoalTrail, ApprovalTrail } from "./trail.js";
```

- Append:
```typescript
// Closing instruction for memory derivations (retrospective / preference).
// The worker's parser (parseMemoryDerivation) understands exactly this contract.
const MEMORY_OUTPUT_CONTRACT = `
If there is nothing durable and reusable worth remembering, reply with exactly
this single word and nothing else:

DISCARD

Otherwise reply with exactly one fenced JSON block and nothing else — one or two
sentences, factual, max 500 characters:

\`\`\`json
{"body":"the durable fact, in one or two sentences"}
\`\`\`

Do not add commentary before or after the block.`;

// Prompt for a `goal.achieved` retrospective — a company-level lesson.
export const buildRetrospectivePrompt = (trail: GoalTrail): string =>
  `A company just achieved a goal. Write a brief retrospective — the one durable
lesson worth remembering company-wide for next time.

## Goal: ${trail.title}

${trail.description}

Success criteria: ${trail.successCriteria}

## Issues done for this goal

${
  trail.issues.length === 0
    ? "(none)"
    : trail.issues.map((i) => `- [${i.status}] ${i.title}`).join("\n")
}
${MEMORY_OUTPUT_CONTRACT}`;

// Prompt for an `approval.rejected` preference — what the user does NOT want.
export const buildPreferencePrompt = (trail: ApprovalTrail): string =>
  `The user just REJECTED an action an agent asked to perform. Capture the
user's preference as a short durable rule, so agents avoid this next time.

## Rejected action (kind: ${trail.kind})

${trail.payloadJson}

## The user's reason

${trail.note === "" ? "(none given)" : trail.note}
${MEMORY_OUTPUT_CONTRACT}`;
```

- [ ] **Step 8: Run the prompt test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/trail.test.ts`
Expected: PASS

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS

```bash
git add apps/main/src/derivation/prompts.ts apps/main/src/derivation/parse-output.ts apps/main/src/derivation/parse-output.test.ts apps/main/src/derivation/trail.test.ts
git commit -m "feat(m11): add memory derivation prompts and parser"
```

---

## Task 4: Worker — the memory output path

The worker grows two new triggers (`goal_achieved`, `approval_rejected`) and a second output path: write a `memory` row instead of a `skill_candidate`.

**Files:**
- Modify: `apps/main/src/derivation/worker.ts`
- Modify: `apps/main/src/derivation/worker.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/main/src/derivation/worker.test.ts`, add this `describe` block. (The file has a `seed()` helper that builds a db with company `c1` + agent `a1` + an `activity_events` row `evt_1`; and the worker is built with a fake `runDerivation`. READ the file first to match the helper shapes.)

```typescript
import { createMemoriesRepository } from "../memory/memories-repository.js";

const memoryOutput = (body: string): RunDerivationResult => ({
  text: `\`\`\`json\n{"body":"${body}"}\n\`\`\``,
  usage: { input: 50, output: 10, cacheCreation: 0, cacheRead: 0 },
});

describe("createDerivationWorker — memory triggers", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
    db.prepare(
      `INSERT INTO goals (id, company_id, title, description, level, status, created_at, updated_at)
       VALUES ('g1','c1','Ship it','d','task','achieved',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO approvals (id, agent_id, kind, payload_json, status, decided_by, decision_note, created_at, resolved_at)
       VALUES ('ap1','a1','tool_call','{"tool":"Bash"}','rejected','user','no force-push',0,0)`,
    ).run();
  });

  it("goal_achieved writes a company-scoped retrospective memory + inbox notice", async () => {
    const worker = createDerivationWorker({
      db,
      runDerivation: () => Promise.resolve(memoryOutput("prefer docker compose for staging")),
      now: () => 1000,
      authEnv: () => ({}),
    });
    await worker.processJob({
      trigger: "goal_achieved",
      companyId: "c1",
      agentId: "a1",
      sourceEventId: "evt_1",
      goalId: "g1",
    });
    const memories = createMemoriesRepository(db).listCompanyWide("c1");
    expect(memories).toHaveLength(1);
    expect(memories[0]?.kind).toBe("retrospective");
    expect(memories[0]?.agentId).toBeNull();
    expect(memories[0]?.body).toBe("prefer docker compose for staging");
    const inbox = db
      .prepare("SELECT kind, requires_action FROM inbox_items WHERE company_id = 'c1'")
      .all() as Array<{ kind: string; requires_action: number }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.kind).toBe("goal_retrospective_ready");
    expect(inbox[0]?.requires_action).toBe(0);
  });

  it("approval_rejected writes an agent-scoped preference memory, no inbox", async () => {
    const worker = createDerivationWorker({
      db,
      runDerivation: () => Promise.resolve(memoryOutput("never force-push without asking")),
      now: () => 1000,
      authEnv: () => ({}),
    });
    await worker.processJob({
      trigger: "approval_rejected",
      companyId: "c1",
      agentId: "a1",
      sourceEventId: "evt_1",
      approvalId: "ap1",
    });
    const memories = createMemoriesRepository(db).listByAgent("a1");
    expect(memories).toHaveLength(1);
    expect(memories[0]?.kind).toBe("preference");
    expect(memories[0]?.body).toBe("never force-push without asking");
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM inbox_items").get() as { n: number }).n,
    ).toBe(0);
  });

  it("writes nothing when the memory derivation discards", async () => {
    const worker = createDerivationWorker({
      db,
      runDerivation: () => Promise.resolve({ text: "DISCARD", usage: memoryOutput("x").usage }),
      now: () => 1000,
      authEnv: () => ({}),
    });
    await worker.processJob({
      trigger: "goal_achieved",
      companyId: "c1",
      agentId: "a1",
      sourceEventId: "evt_1",
      goalId: "g1",
    });
    expect(createMemoriesRepository(db).listCompanyWide("c1")).toHaveLength(0);
    // a discard still ran — the cost_event is still recorded
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM cost_events").get() as { n: number }).n,
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/worker.test.ts`
Expected: FAIL — `processJob` rejects the `goal_achieved` trigger (type error on the `DerivationJob` literal, or it falls into the recovery branch).

- [ ] **Step 3: Extend the worker**

In `apps/main/src/derivation/worker.ts`:

- Add imports after the existing ones:
```typescript
import { buildGoalTrail, buildApprovalTrail } from "./trail.js";
import { buildRetrospectivePrompt, buildPreferencePrompt } from "./prompts.js";
import { parseMemoryDerivation } from "./parse-output.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
```

- Change the `DerivationJob` type:
```typescript
export type DerivationJob = {
  trigger: "issue_done" | "recovery" | "goal_achieved" | "approval_rejected";
  companyId: string;
  agentId: string;
  sourceEventId: string;
  issueId?: string;
  goalId?: string;
  approvalId?: string;
};
```

- Replace the prompt-building block (the `let prompt: string; if (job.trigger === "issue_done") { ... } else { ... }`) with a four-way branch:
```typescript
      let prompt: string;
      if (job.trigger === "issue_done") {
        if (job.issueId === undefined) {
          log("issue_done job has no issueId — skipping");
          return;
        }
        const trail = buildIssueTrail(db, job.issueId);
        if (trail === null) {
          log(`issue ${job.issueId} not found — skipping`);
          return;
        }
        prompt = buildIssuePrompt(trail);
      } else if (job.trigger === "recovery") {
        const trail = buildRecoveryTrail(db, job.agentId, RECOVERY_TRAIL_LIMIT);
        if (trail === null || trail.messages.length === 0) {
          log(`no recovery trail for agent ${job.agentId} — skipping`);
          return;
        }
        prompt = buildRecoveryPrompt(trail);
      } else if (job.trigger === "goal_achieved") {
        if (job.goalId === undefined) {
          log("goal_achieved job has no goalId — skipping");
          return;
        }
        const trail = buildGoalTrail(db, job.goalId);
        if (trail === null) {
          log(`goal ${job.goalId} not found — skipping`);
          return;
        }
        prompt = buildRetrospectivePrompt(trail);
      } else {
        if (job.approvalId === undefined) {
          log("approval_rejected job has no approvalId — skipping");
          return;
        }
        const trail = buildApprovalTrail(db, job.approvalId);
        if (trail === null) {
          log(`approval ${job.approvalId} not found — skipping`);
          return;
        }
        prompt = buildPreferencePrompt(trail);
      }
```

- The `runDerivation` call and the `createCostsRepository(db).insert({...})` cost block stay UNCHANGED.

- Replace the output-handling block (everything from `const parsed = parseDerivationOutput(result.text);` to the end of the `createInboxRepository(db).create({...})` for `skill_candidate_pending`) with this trigger-routed version:
```typescript
      if (job.trigger === "issue_done" || job.trigger === "recovery") {
        const parsed = parseDerivationOutput(result.text);
        if (parsed.kind === "discard") {
          log(`agent ${job.agentId} ${job.trigger}: derivation discarded`);
          return;
        }
        const bodyCheck = sanitizeMemoryBody(parsed.draft.body);
        if (!bodyCheck.ok) {
          log(`sanitizer rejected derived body: ${bodyCheck.reason} — dropping`);
          return;
        }
        const descCheck = sanitizeMemoryBody(parsed.draft.description);
        if (!descCheck.ok) {
          log(`sanitizer rejected derived description: ${descCheck.reason} — dropping`);
          return;
        }
        const candidate = createSkillCandidatesRepository(db).create({
          companyId: job.companyId,
          agentId: job.agentId,
          sourceEventId: job.sourceEventId,
          trigger: job.trigger,
          proposedName: parsed.draft.name,
          proposedDescription: parsed.draft.description,
          proposedBody: parsed.draft.body,
        });
        createInboxRepository(db).create({
          companyId: job.companyId,
          kind: "skill_candidate_pending",
          actorId: job.agentId,
          title: `New skill candidate: ${parsed.draft.name}`,
          preview: parsed.draft.description,
          requiresAction: true,
          payloadJson: JSON.stringify({ candidateId: candidate.id }),
        });
        return;
      }

      // goal_achieved / approval_rejected → a memory row (no human review).
      const parsedMemory = parseMemoryDerivation(result.text);
      if (parsedMemory.kind === "discard") {
        log(`agent ${job.agentId} ${job.trigger}: memory derivation discarded`);
        return;
      }
      const memCheck = sanitizeMemoryBody(parsedMemory.body);
      if (!memCheck.ok) {
        log(`sanitizer rejected derived memory: ${memCheck.reason} — dropping`);
        return;
      }
      if (job.trigger === "goal_achieved") {
        createMemoriesRepository(db).create({
          companyId: job.companyId,
          agentId: null,
          kind: "retrospective",
          body: parsedMemory.body,
          sourceEventId: job.sourceEventId,
        });
        createInboxRepository(db).create({
          companyId: job.companyId,
          kind: "goal_retrospective_ready",
          title: "New goal retrospective",
          preview: parsedMemory.body.slice(0, 200),
          requiresAction: false,
          payloadJson: JSON.stringify({ goalId: job.goalId }),
        });
      } else {
        createMemoriesRepository(db).create({
          companyId: job.companyId,
          agentId: job.agentId,
          kind: "preference",
          body: parsedMemory.body,
          sourceEventId: job.sourceEventId,
        });
      }
```

> `parseDerivationOutput` (skill) and `createSkillCandidatesRepository` are still imported and used — keep their imports. `cost_events` for memory derivations carry `issueId: job.issueId ?? null` which is `null` for goal/approval jobs — that is fine (the column is nullable).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/worker.test.ts`
Expected: PASS — the existing skill tests plus the 3 new memory tests.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS

```bash
git add apps/main/src/derivation/worker.ts apps/main/src/derivation/worker.test.ts
git commit -m "feat(m11): derive retrospective and preference memories in the worker"
```

---

## Task 5: Dispatcher — the `goal_achieved` / `approval_rejected` triggers

`jobForActivity` detects the two activity actions that feed the memory derivations.

**Files:**
- Modify: `apps/main/src/derivation/dispatcher.ts`
- Modify: `apps/main/src/derivation/dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/main/src/derivation/dispatcher.test.ts`, add (the file has a `row(...)` helper that builds an `ActivityEventRow` and a `collect()` helper — read it and reuse):

```typescript
describe("createDerivationDispatcher — memory triggers", () => {
  it("enqueues a goal_achieved job for a goal moved to achieved", async () => {
    const { jobs, processJob } = collect();
    const d = createDerivationDispatcher({ processJob });
    d.onActivity(
      row({
        action: "goal.status_changed",
        entityKind: "goal",
        entityId: "g1",
        payload: { from: "in_progress", to: "achieved" },
      }),
    );
    await d.idle();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ trigger: "goal_achieved", goalId: "g1" });
  });

  it("ignores a goal status change that is not to achieved", async () => {
    const { jobs, processJob } = collect();
    const d = createDerivationDispatcher({ processJob });
    d.onActivity(row({ action: "goal.status_changed", payload: { to: "in_progress" } }));
    await d.idle();
    expect(jobs).toHaveLength(0);
  });

  it("enqueues an approval_rejected job for approval.rejected", async () => {
    const { jobs, processJob } = collect();
    const d = createDerivationDispatcher({ processJob });
    d.onActivity(
      row({ action: "approval.rejected", entityKind: "approval", entityId: "ap1", payload: {} }),
    );
    await d.idle();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ trigger: "approval_rejected", approvalId: "ap1" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/dispatcher.test.ts`
Expected: FAIL — no job is enqueued for the new actions.

- [ ] **Step 3: Extend `jobForActivity`**

In `apps/main/src/derivation/dispatcher.ts`, in `jobForActivity`, add these two blocks before the final `return null;`:

```typescript
  if (row.action === "goal.status_changed" && row.payload["to"] === "achieved") {
    return {
      trigger: "goal_achieved",
      companyId: row.companyId,
      agentId: row.agentId,
      sourceEventId: row.id,
      goalId: row.entityId,
    };
  }
  if (row.action === "approval.rejected") {
    return {
      trigger: "approval_rejected",
      companyId: row.companyId,
      agentId: row.agentId,
      sourceEventId: row.id,
      approvalId: row.entityId,
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/derivation/dispatcher.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS

```bash
git add apps/main/src/derivation/dispatcher.ts apps/main/src/derivation/dispatcher.test.ts
git commit -m "feat(m11): dispatch goal-achieved and approval-rejected derivations"
```

---

## Task 6: `orgLearnings` IPC handler + channel

A read-only IPC that returns the company's top shared skills + recent retrospective memories — the data for the dashboard card.

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/tests/ipc-channels.test.ts`
- Modify: `apps/main/src/ipc/learning-handlers.ts`
- Modify: `apps/main/tests/ipc.learning-handlers.test.ts`

- [ ] **Step 1: Add the channel + test**

In `packages/shared/src/ipc-channels.ts`, add inside the `IPC` object before `} as const;`:

```typescript
  LEARNING_ORG: "learning:org-learnings",
```

In `packages/shared/tests/ipc-channels.test.ts`, add inside `describe("IPC channels", ...)`:

```typescript
  it("exposes the M11 org-learnings channel", () => {
    expect(IPC.LEARNING_ORG).toBe("learning:org-learnings");
  });
```

- [ ] **Step 2: Write the failing handler test**

In `apps/main/tests/ipc.learning-handlers.test.ts`, append (the file has a `seed()` helper + `USERDATA` const + imports `createSkillsRepository`; add a `createMemoriesRepository` import):

```typescript
import { createMemoriesRepository } from "../src/memory/memories-repository.js";

describe("learningHandlers — orgLearnings", () => {
  it("returns company-shared skills and recent retrospective memories", () => {
    const db = seed();
    createSkillsRepository(db).create({
      companyId: "c1",
      agentId: null,
      name: "deploy-runbook",
      bodyPath: "p",
      description: "shared",
      source: "user_authored",
    });
    const memories = createMemoriesRepository(db);
    memories.create({
      companyId: "c1",
      agentId: null,
      kind: "retrospective",
      body: "RETRO-BODY",
    });
    memories.create({ companyId: "c1", agentId: null, kind: "rule", body: "not a retro" });
    const out = learningHandlers(db, USERDATA).orgLearnings({ companyId: "c1" });
    expect(out.topSkills.map((s) => s.name)).toEqual(["deploy-runbook"]);
    expect(out.recentRetrospectives.map((m) => m.body)).toEqual(["RETRO-BODY"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: FAIL — `orgLearnings` is not a function.

- [ ] **Step 4: Add the handler**

In `apps/main/src/ipc/learning-handlers.ts`:

- Add `Memory` to the `@prospero/shared` type import if not present (the file imports `Skill`, `Memory`, etc. already — verify; if `Memory` is missing, add it).
- Add the `createMemoriesRepository` import if not present (the file already imports it for `listMemories` — verify).
- Add to the `LearningHandlers` type, after `approveSkillPromotion`:

```typescript
  // Dashboard "Org Learnings" data: top company-shared skills + recent
  // retrospective memories.
  orgLearnings(args: { companyId: string }): {
    topSkills: Skill[];
    recentRetrospectives: Memory[];
  };
```

- Add the method to the returned object, after `approveSkillPromotion`:

```typescript
    orgLearnings({ companyId }) {
      const topSkills = createSkillsRepository(db).listCompanyShared(companyId).slice(0, 10);
      const recentRetrospectives = createMemoriesRepository(db)
        .listCompanyWide(companyId)
        .filter((m) => m.kind === "retrospective")
        .slice(0, 5);
      return { topSkills, recentRetrospectives };
    },
```

- In `registerLearningHandlers`, add the channel registration after the `SKILL_PROMOTE_APPROVE` handler:

```typescript
  ipcMain.handle(IPC.LEARNING_ORG, (_e, args: { companyId: string }) => h.orgLearnings(args));
```

> `listCompanyShared` returns skills already ordered by `use_count DESC` (so `.slice(0,10)` is "top 10 by use"); `listCompanyWide` returns memories ordered by `importance DESC`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: PASS

Run: `pnpm --filter @prospero/shared test`
Expected: PASS (the channel test)

- [ ] **Step 6: Add the preload bridge + `env.d.ts`**

In `apps/main/src/ipc/preload.ts`, inside the `learning: { ... }` namespace, after `approveSkillPromotion`, add:

```typescript
    orgLearnings: (companyId: string) =>
      ipcRenderer.invoke(IPC.LEARNING_ORG, { companyId }) as Promise<{
        topSkills: Skill[];
        recentRetrospectives: Memory[];
      }>,
```

In `apps/renderer/src/env.d.ts`, inside the `learning: { ... }` interface, after `approveSkillPromotion`, add:

```typescript
        orgLearnings: (companyId: string) => Promise<{
          topSkills: Skill[];
          recentRetrospectives: Memory[];
        }>;
```

> `Skill` and `Memory` are already imported in both `preload.ts` and `env.d.ts`.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS

```bash
git add packages/shared/src/ipc-channels.ts packages/shared/tests/ipc-channels.test.ts apps/main/src/ipc/learning-handlers.ts apps/main/tests/ipc.learning-handlers.test.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m11): add the org-learnings ipc handler"
```

---

## Task 7: Org Learnings dashboard widget

A `/dashboard` card showing the company's top shared skills + recent retrospectives.

**Files:**
- Create: `apps/renderer/src/components/dashboard/OrgLearningsWidget.tsx`
- Modify: `apps/renderer/src/routes/Dashboard.tsx`
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 1: Add the parity check (failing test first)**

In `apps/renderer/src/i18n/parity.test.ts`, add at the end of the `describe("i18n parity", ...)` block:

```typescript
  it("includes the M11 PR-E org-learnings widget keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "dashboard.orgLearnings.title",
      "dashboard.orgLearnings.skills",
      "dashboard.orgLearnings.retrospectives",
      "dashboard.orgLearnings.empty",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: FAIL — the keys are missing.

- [ ] **Step 3: Add the i18n keys**

In `apps/renderer/src/i18n/pt-BR.json`, find the `dashboard` object and add an `orgLearnings` child block inside it (mind the trailing comma):

```json
  "orgLearnings": {
   "title": "Aprendizados da empresa",
   "skills": "Skills compartilhados",
   "retrospectives": "Retrospectivas recentes",
   "empty": "A empresa ainda não acumulou aprendizados."
  }
```

In `apps/renderer/src/i18n/en-US.json`, mirror it inside the `dashboard` object:

```json
  "orgLearnings": {
   "title": "Org learnings",
   "skills": "Shared skills",
   "retrospectives": "Recent retrospectives",
   "empty": "The company hasn't accumulated learnings yet."
  }
```

- [ ] **Step 4: Run the parity test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS

- [ ] **Step 5: Create the widget**

READ a sibling dashboard widget first — `apps/renderer/src/components/dashboard/InboxUnreadWidget.tsx` (or `CostsTodayWidget.tsx`, which takes a `companyId` prop) — to match the card markup (`bg-surface-card border ... rounded-lg p-5`, title style). Then create `apps/renderer/src/components/dashboard/OrgLearningsWidget.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";

interface Props {
  companyId: string;
}

// Dashboard card: what the company has learned — top shared skills + recent
// goal retrospectives. M11 org-learning surface.
export const OrgLearningsWidget: FC<Props> = ({ companyId }) => {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [retros, setRetros] = useState<Memory[]>([]);

  useEffect(() => {
    void (async () => {
      const out = await window.prospero.learning.orgLearnings(companyId);
      setSkills(out.topSkills);
      setRetros(out.recentRetrospectives);
    })();
  }, [companyId]);

  const empty = skills.length === 0 && retros.length === 0;

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <h3 className="text-sm font-semibold text-ink mb-3">
        {t("dashboard.orgLearnings.title")}
      </h3>
      {empty ? (
        <p className="text-xs text-ink-muted">{t("dashboard.orgLearnings.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {skills.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
                {t("dashboard.orgLearnings.skills")}
              </p>
              <ul className="flex flex-col gap-0.5">
                {skills.map((s) => (
                  <li key={s.id} className="text-xs text-ink-muted">
                    <span className="text-ink">{s.name}</span> · {s.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {retros.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
                {t("dashboard.orgLearnings.retrospectives")}
              </p>
              <ul className="flex flex-col gap-1">
                {retros.map((m) => (
                  <li key={m.id} className="text-xs text-ink-muted">
                    {m.body}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 6: Add the widget to the dashboard grid**

In `apps/renderer/src/routes/Dashboard.tsx`:
- Add the import alongside the other widget imports:
```typescript
import { OrgLearningsWidget } from "../components/dashboard/OrgLearningsWidget.js";
```
- In the widget grid (the `<div className="grid ...">` containing `<ActiveAgentsWidget />` etc.), add `<OrgLearningsWidget companyId={companyId} />` as the last widget. (`companyId` is already in scope in `Dashboard.tsx` — it is passed to `CostsTodayWidget`. Use the same value.)

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 8: Full verification**

Run: `pnpm test`
Expected: PASS — all prior tests plus the new migration, trail, prompt, parser, worker, dispatcher, handler, and parity tests; no regressions. If `agents-md-handlers.test.ts` times out under parallel load, re-run `pnpm test` once.

- [ ] **Step 9: Commit**

```bash
git add apps/renderer/src/components/dashboard/OrgLearningsWidget.tsx apps/renderer/src/routes/Dashboard.tsx apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m11): add the org-learnings dashboard widget"
```

---

## Notes for every task

- Branch is `main`; commit directly to `main` (no feature branch — the established workflow).
- commitlint rejects uppercase / `+` / `%` in the commit subject — use the messages verbatim.
- Run each verification command on its own; confirm the result before committing — do NOT pipe test output through `grep` then `&&` commit (the pipe masks failures).
- TDD: write the test, see it fail, implement, see it pass, commit.
- The pre-commit hook runs prettier/eslint and may reformat — that is expected.

---

## Self-Review notes

- **Spec coverage (§2.2-2.4, §7, §10, §11 PR-E):** `goal.achieved` → retrospective memory (company scope) + `goal_retrospective_ready` inbox → Tasks 1, 2, 3, 4, 5 (§2.4 row 3, §7 step 7); `approval.rejected` → preference memory (agent scope) → Tasks 2, 3, 4, 5 (§2.3, §2.4 row 4); the derivation passes the sanitizer before becoming a memory → Task 4 (`sanitizeMemoryBody` — §9); the `/dashboard` "Org Learnings" card → Tasks 6, 7 (§10). **Deliberately deferred** (documented in "Decisions"): the terminate-modal "promote private skills?" + 30-day-TTL cascade → **PR-F** (it is a decay/maintenance concern); the issue-regression preference signal → later (secondary to `approval.rejected`).
- **Placeholder scan:** every code step ships complete code; every command has an expected result. Failure paths are concrete — the worker logs + returns on missing goalId/approvalId, missing goal/approval, discard, and sanitizer rejection (Task 4 tests cover discard); `parseMemoryDerivation` never throws (Task 3 tests cover malformed/empty/no-block).
- **Type consistency:** `DerivationJob` gains `goalId?`/`approvalId?` in Task 4 and the dispatcher (Task 5) populates them. `GoalTrail`/`ApprovalTrail` are defined in `trail.ts` (Task 2) and consumed by `prompts.ts` (Task 3). `ParsedMemory` is defined in `parse-output.ts` (Task 3) and consumed by `worker.ts` (Task 4). `orgLearnings`'s return shape `{ topSkills: Skill[]; recentRetrospectives: Memory[] }` is identical across `LearningHandlers`, the preload, `env.d.ts`, and the widget. The four derivation triggers are spelled identically everywhere: `issue_done`, `recovery`, `goal_achieved`, `approval_rejected`.
- **Non-regression:** the worker's existing `issue_done`/`recovery` → `skill_candidate` path is preserved verbatim inside the `if (job.trigger === "issue_done" || job.trigger === "recovery")` branch — the PR-D1/D2 behavior is unchanged. Memory derivations are sanitized (§9). The cap (`cost_events adapter='derivation'`, keyed on the activity's `agentId`) is reused untouched — a retrospective counts against the CEO's daily budget. Migration `0021` follows the `0020` recreate-table pattern. The `Record<InboxKind>` exhaustiveness break in `Inbox.tsx` is handled in Task 1.
- **Out of scope (PR-F):** terminate-modal promote + TTL cascade; decay/trust; Settings (`user.md` editor + derivation budget slider); nudges; docs. PR-F closes M11.
