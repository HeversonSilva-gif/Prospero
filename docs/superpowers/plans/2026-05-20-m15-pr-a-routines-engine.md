# M15 PR-A — Routines engine (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend of M15 — a Routines engine that wakes target agents on a schedule (tick loop) or in response to fixed activity events, enqueueing a turn via the existing router. UI is PR-B; this PR is renderer-invisible end-to-end through IPC.

**Architecture:** A pure-data `routines` table + a tiny composition of three modules — `recurrence.ts` (next-fire math), `scheduler.ts` (in-process tick loop, ~30s, with coalesced catch-up), `event-matcher.ts` (observer that mirrors `derivation/dispatcher.ts`) — all glued by `engine.ts`. Firing goes through `fire.ts`, which calls `ensureAgentRunner` + `router.enqueue` with a new `Sender.kind = "routine"` variant. The engine plugs into the existing single-observer slot of `initRecorder` (the slot today carries derivation; we fan-out to derivation + routines).

**Tech Stack:** TypeScript · better-sqlite3 (existing migrations runner) · Vitest (unit + integration) · Zod (input validation, main-side only — never in `@prospero/shared`) · existing `apps/main/src/orchestrator/router.ts` for `enqueue` · existing `apps/main/src/activity/recorder.ts` for audit events.

**Spec:** `docs/superpowers/specs/2026-05-18-m15-routines-design.md`. Pre-req: M14 closed (HEAD before this work: `0879da2`).

---

## File map (created/modified in this PR)

**Created:**
- `apps/main/src/db/migrations/0035_m15_routines.sql` — table + indexes
- `apps/main/src/db/migrations/0035.test.ts` — migration test
- `packages/shared/src/types/routine.ts` — `Routine`, `ScheduleSpec`, `EventSpec`, `RoutineTriggerType`, `RoutineEventType`, `FireReason`
- `apps/main/src/schemas/routine.ts` — Zod input schemas
- `apps/main/src/schemas/routine.test.ts`
- `apps/main/src/routines/repository.ts` — `RoutinesRepository` (CRUD + due-list + nextFire/lastFired writers)
- `apps/main/src/routines/repository.test.ts`
- `apps/main/src/routines/recurrence.ts` — `computeNextFire(spec, after)`
- `apps/main/src/routines/recurrence.test.ts`
- `apps/main/src/routines/scheduler.ts` — `createRoutineScheduler`
- `apps/main/src/routines/scheduler.test.ts`
- `apps/main/src/routines/event-matcher.ts` — `routinesForActivity`
- `apps/main/src/routines/event-matcher.test.ts`
- `apps/main/src/routines/fire.ts` — `fireRoutine(routine, reason, deps)`
- `apps/main/src/routines/fire.test.ts`
- `apps/main/src/routines/engine.ts` — composition + lifecycle
- `apps/main/src/routines/engine.test.ts`
- `apps/main/src/routines/index.ts` — public exports for handlers.ts (singleton accessor)
- `apps/main/src/ipc/routines-handlers.ts` — 5 IPC handlers
- `apps/main/tests/routines-handlers.test.ts`

**Modified:**
- `packages/shared/src/types/activity.ts` — add `"routine"` to `EntityKind`; add `routine.fired` + `routine.skipped` to `ACTIVITY_ACTIONS`
- `packages/shared/src/types/index.ts` — re-export `routine.ts`
- `packages/shared/src/ipc-channels.ts` — 5 new constants
- `apps/main/src/activity/schemas.ts` — Zod schemas for the 2 new actions
- `apps/main/src/orchestrator/router.ts` — extend `Sender.kind` union with `"routine"`
- `apps/main/src/ipc/preload.ts` — expose `routines: { list, create, update, delete, runNow }` blob
- `apps/main/src/ipc/handlers.ts` — instantiate engine, fan-out observer, register IPC handlers
- `apps/main/src/ipc/orchestrator-handlers.ts` — call `routines.start({ router, ensureAgentRunner, agentsRepo })` once router and ensureAgentRunner are defined

---

## Conventions for this plan

- Every step shows the actual code; **never** `// ...` placeholders.
- Run tests after each change. After typecheck-only changes (types, schemas), also run `pnpm typecheck` — Vitest with esbuild does **not** catch type holes (lesson `project_m14_pr_a_lessons`).
- Commit after each task. Subject lowercase, no `+`/`%`, ≤72 chars (commitlint).
- Always run `git status --short` + `git diff HEAD --stat` before the final commit of a task to confirm disk == staged == HEAD (lesson `project_m13_pr_f_lessons`).
- `pnpm -w` runs in the workspace root. From the project root `D:\Projetos pessoais\DashboardAgent`:
  - Full suite: `pnpm test`
  - Just main: `pnpm --filter @prospero/main test`
  - Just shared: `pnpm --filter @prospero/shared test`
  - One file: `pnpm --filter @prospero/main test apps/main/src/routines/recurrence.test.ts`
  - Typecheck all: `pnpm typecheck`
  - Lint all: `pnpm lint`

---

## Task 1: Migration 0035 — `routines` table

**Files:**
- Create: `apps/main/src/db/migrations/0035_m15_routines.sql`
- Create: `apps/main/src/db/migrations/0035.test.ts`

- [ ] **Step 1: Write the migration SQL**

Create `apps/main/src/db/migrations/0035_m15_routines.sql`:

```sql
-- M15 PR-A Task 1: Routines — agents that wake on a schedule or on a fixed
-- activity event. trigger_type discriminates the two columns sets; schedule
-- routines have schedule_spec + next_fire_at; event routines have event_spec.
-- target_agent_id cascades on agent termination/delete — a routine without a
-- live target is unreachable.

CREATE TABLE routines (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('schedule','event')),
  schedule_spec   TEXT,
  next_fire_at    INTEGER,
  event_spec      TEXT,
  target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  instruction     TEXT NOT NULL,
  last_fired_at   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_routines_company   ON routines(company_id);
CREATE INDEX idx_routines_next_fire ON routines(next_fire_at);
```

- [ ] **Step 2: Write the migration test**

Create `apps/main/src/db/migrations/0035.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0035 — routines table", () => {
  const setup = (): Database.Database => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, model,
                           status, mode, always_on, capabilities_json,
                           created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'idle', 'supervised', 0, '[]', ?, ?)`,
    ).run("a1", "c1", "Bob", "engineer", "", "claude-sonnet-4-6", Date.now(), Date.now());
    return db;
  };

  it("creates the table with all expected columns and defaults enabled=1", () => {
    const db = setup();
    db.prepare(
      `INSERT INTO routines (id, company_id, name, trigger_type, schedule_spec,
                             next_fire_at, target_agent_id, instruction,
                             created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("r1", "c1", "Standup", "schedule", '{"freq":"daily","atMinute":540}', 1000, "a1", "Run standup", 1, 1);
    const row = db.prepare("SELECT * FROM routines WHERE id = ?").get("r1") as Record<string, unknown>;
    expect(row.enabled).toBe(1);
    expect(row.trigger_type).toBe("schedule");
    expect(row.schedule_spec).toBe('{"freq":"daily","atMinute":540}');
    expect(row.next_fire_at).toBe(1000);
    expect(row.event_spec).toBeNull();
    expect(row.last_fired_at).toBeNull();
  });

  it("rejects trigger_type values outside the CHECK constraint", () => {
    const db = setup();
    expect(() =>
      db.prepare(
        `INSERT INTO routines (id, company_id, name, trigger_type,
                               target_agent_id, instruction, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("r2", "c1", "X", "manual", "a1", "Hi", 1, 1),
    ).toThrow();
  });

  it("cascades delete from companies", () => {
    const db = setup();
    db.prepare(
      `INSERT INTO routines (id, company_id, name, trigger_type,
                             target_agent_id, instruction, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("r1", "c1", "X", "schedule", "a1", "Hi", 1, 1);
    db.prepare("DELETE FROM companies WHERE id = ?").run("c1");
    const row = db.prepare("SELECT id FROM routines WHERE id = ?").get("r1");
    expect(row).toBeUndefined();
  });

  it("cascades delete from agents", () => {
    const db = setup();
    db.prepare(
      `INSERT INTO routines (id, company_id, name, trigger_type,
                             target_agent_id, instruction, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("r1", "c1", "X", "schedule", "a1", "Hi", 1, 1);
    db.prepare("DELETE FROM agents WHERE id = ?").run("a1");
    const row = db.prepare("SELECT id FROM routines WHERE id = ?").get("r1");
    expect(row).toBeUndefined();
  });

  it("creates idx_routines_company and idx_routines_next_fire", () => {
    const db = setup();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'routines'")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_routines_company");
    expect(names).toContain("idx_routines_next_fire");
  });
});
```

- [ ] **Step 3: Run the migration test**

Run: `pnpm --filter @prospero/main test apps/main/src/db/migrations/0035.test.ts`
Expected: 5 passing.

- [ ] **Step 4: Confirm full main suite still green**

Run: `pnpm --filter @prospero/main test`
Expected: all green, +5 tests vs HEAD.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/db/migrations/0035_m15_routines.sql apps/main/src/db/migrations/0035.test.ts
git commit -m "feat(routines): add migration 0035 routines table"
```

---

## Task 2: Shared types (`Routine`, specs, action vocab)

**Files:**
- Create: `packages/shared/src/types/routine.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/types/activity.ts:9-17` (extend `EntityKind`)
- Modify: `packages/shared/src/types/activity.ts:19-74` (extend `ACTIVITY_ACTIONS`)
- Modify: `apps/main/src/activity/schemas.ts` (extend `ActivityPayloads`)

- [ ] **Step 1: Create the routine type module**

Create `packages/shared/src/types/routine.ts`:

```typescript
// M15 — Routine: an agent target + an instruction, fired on a schedule or on
// a fixed activity event. The shared layer is type-only (no zod — see lesson
// project_m7_6_lessons); zod input validation lives in apps/main/src/schemas.

export type RoutineTriggerType = "schedule" | "event";

export type ScheduleSpec =
  | { freq: "daily"; atMinute: number }
  | { freq: "weekly"; weekday: number; atMinute: number }
  | { freq: "monthly"; day: number; atMinute: number }
  | { freq: "interval"; everyMinutes: number };

export type RoutineEventType =
  | "goal_achieved"
  | "verification_failed"
  | "issue_done"
  | "agent_recovered";

export interface EventSpec {
  eventType: RoutineEventType;
}

export interface Routine {
  id: string;
  companyId: string;
  name: string;
  enabled: boolean;
  triggerType: RoutineTriggerType;
  scheduleSpec: ScheduleSpec | null;
  nextFireAt: number | null;
  eventSpec: EventSpec | null;
  targetAgentId: string;
  instruction: string;
  lastFiredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type FireReason = "scheduled" | "catchup" | "event" | "manual";
```

- [ ] **Step 2: Re-export from the shared barrel**

Open `packages/shared/src/types/index.ts` and add the export. Read it first to find the alphabetic insertion point — it lists modules like `activity`, `adapter`, `agent`, etc. Add:

```typescript
export * from "./routine.js";
```

(Keep alphabetic order — between `role.js` and `security.js` if both already exist.)

- [ ] **Step 3: Extend `EntityKind` and `ACTIVITY_ACTIONS`**

In `packages/shared/src/types/activity.ts`, replace the `EntityKind` union with:

```typescript
export type EntityKind =
  | "agent"
  | "issue"
  | "project"
  | "approval"
  | "session"
  | "company"
  | "goal"
  | "routine";
```

Then in `ACTIVITY_ACTIONS`, after the `// Trust (4) — M14 PR-A trust ladder` block (`"trust.readonly_autoapproved",`) and before `// Session / Cost (3)`, insert:

```typescript
  // Routine (2) — M15 PR-A
  "routine.fired",
  "routine.skipped",
```

- [ ] **Step 4: Add Zod payload schemas for the 2 new actions**

In `apps/main/src/activity/schemas.ts`, inside the `ActivityPayloads` object (after the `// Trust (4)` block, before the closing `} satisfies Record<ActivityAction, z.ZodTypeAny>;`):

```typescript
  // Routine (2) — M15 PR-A
  "routine.fired": z.object({
    reason: z.enum(["scheduled", "catchup", "event", "manual"]),
  }),
  "routine.skipped": z.object({
    reason: z.enum(["agent_unavailable", "budget_paused"]),
    detail: z.string().optional(),
  }),
```

- [ ] **Step 5: Run shared + main suites + typecheck**

Run:

```bash
pnpm typecheck
pnpm --filter @prospero/shared test
pnpm --filter @prospero/main test
```

Expected: all green. The existing `apps/main/tests/activity.schemas.test.ts` (exhaustive vocab test) will pass automatically — the `satisfies Record<ActivityAction, ...>` clause forces a Zod entry per new action at typecheck time.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/routine.ts packages/shared/src/types/index.ts packages/shared/src/types/activity.ts apps/main/src/activity/schemas.ts
git commit -m "feat(routines): add shared types and activity actions"
```

---

## Task 3: Zod input schemas (main-side)

**Files:**
- Create: `apps/main/src/schemas/routine.ts`
- Create: `apps/main/src/schemas/routine.test.ts`

- [ ] **Step 1: Write input schema tests**

Create `apps/main/src/schemas/routine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  ROUTINE_CREATE_INPUT_SCHEMA,
  ROUTINE_UPDATE_INPUT_SCHEMA,
} from "./routine.js";

describe("ROUTINE_CREATE_INPUT_SCHEMA", () => {
  const baseSchedule = {
    companyId: "c1",
    name: "Standup",
    enabled: true,
    triggerType: "schedule" as const,
    scheduleSpec: { freq: "daily" as const, atMinute: 540 },
    targetAgentId: "a1",
    instruction: "Run standup",
  };
  const baseEvent = {
    companyId: "c1",
    name: "Watch goals",
    enabled: true,
    triggerType: "event" as const,
    eventSpec: { eventType: "goal_achieved" as const },
    targetAgentId: "a1",
    instruction: "React",
  };

  it("accepts a valid schedule input", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse(baseSchedule);
    expect(r.success).toBe(true);
  });

  it("accepts a valid event input", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse(baseEvent);
    expect(r.success).toBe(true);
  });

  it("rejects schedule without scheduleSpec", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseSchedule,
      scheduleSpec: undefined,
    });
    expect(r.success).toBe(false);
  });

  it("rejects event without eventSpec", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseEvent,
      eventSpec: undefined,
    });
    expect(r.success).toBe(false);
  });

  it("rejects scheduleSpec with atMinute out of [0, 1440)", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseSchedule,
      scheduleSpec: { freq: "daily", atMinute: 1440 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects weekly with weekday out of [0,6]", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseSchedule,
      scheduleSpec: { freq: "weekly", weekday: 7, atMinute: 540 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects monthly with day=0 or day>28", () => {
    expect(
      ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
        ...baseSchedule,
        scheduleSpec: { freq: "monthly", day: 0, atMinute: 540 },
      }).success,
    ).toBe(false);
    expect(
      ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
        ...baseSchedule,
        scheduleSpec: { freq: "monthly", day: 29, atMinute: 540 },
      }).success,
    ).toBe(false);
  });

  it("rejects interval with everyMinutes < 1", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseSchedule,
      scheduleSpec: { freq: "interval", everyMinutes: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty name and empty instruction", () => {
    expect(
      ROUTINE_CREATE_INPUT_SCHEMA.safeParse({ ...baseSchedule, name: "" }).success,
    ).toBe(false);
    expect(
      ROUTINE_CREATE_INPUT_SCHEMA.safeParse({ ...baseSchedule, instruction: "" }).success,
    ).toBe(false);
  });
});

describe("ROUTINE_UPDATE_INPUT_SCHEMA", () => {
  it("accepts a partial patch with just enabled", () => {
    const r = ROUTINE_UPDATE_INPUT_SCHEMA.safeParse({ id: "r1", enabled: false });
    expect(r.success).toBe(true);
  });

  it("requires an id", () => {
    const r = ROUTINE_UPDATE_INPUT_SCHEMA.safeParse({ enabled: false });
    expect(r.success).toBe(false);
  });

  it("when scheduleSpec is provided, validates its shape", () => {
    const r = ROUTINE_UPDATE_INPUT_SCHEMA.safeParse({
      id: "r1",
      scheduleSpec: { freq: "daily", atMinute: 9999 },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @prospero/main test apps/main/src/schemas/routine.test.ts`
Expected: FAIL — `routine.js` not found.

- [ ] **Step 3: Implement the schemas**

Create `apps/main/src/schemas/routine.ts`:

```typescript
import { z } from "zod";

// M15 PR-A — Zod validation lives main-side (shared has no zod dep).
// Mirrors packages/shared/src/types/routine.ts.

const ScheduleSpecSchema = z.discriminatedUnion("freq", [
  z.object({
    freq: z.literal("daily"),
    atMinute: z.number().int().min(0).max(1439),
  }),
  z.object({
    freq: z.literal("weekly"),
    weekday: z.number().int().min(0).max(6),
    atMinute: z.number().int().min(0).max(1439),
  }),
  z.object({
    freq: z.literal("monthly"),
    day: z.number().int().min(1).max(28),
    atMinute: z.number().int().min(0).max(1439),
  }),
  z.object({
    freq: z.literal("interval"),
    everyMinutes: z.number().int().min(1),
  }),
]);

const EventSpecSchema = z.object({
  eventType: z.enum([
    "goal_achieved",
    "verification_failed",
    "issue_done",
    "agent_recovered",
  ]),
});

const baseFields = {
  companyId: z.string().min(1),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  targetAgentId: z.string().min(1),
  instruction: z.string().min(1).max(4000),
};

// One-of-two-shapes: a `schedule` routine must include scheduleSpec; an
// `event` routine must include eventSpec. discriminatedUnion enforces this.
export const ROUTINE_CREATE_INPUT_SCHEMA = z.discriminatedUnion("triggerType", [
  z.object({
    triggerType: z.literal("schedule"),
    scheduleSpec: ScheduleSpecSchema,
    ...baseFields,
  }),
  z.object({
    triggerType: z.literal("event"),
    eventSpec: EventSpecSchema,
    ...baseFields,
  }),
]);

export type RoutineCreateInput = z.infer<typeof ROUTINE_CREATE_INPUT_SCHEMA>;

// Updates are a partial — every mutable field is optional but `id` is required.
// If scheduleSpec or eventSpec is provided, its shape is fully validated.
export const ROUTINE_UPDATE_INPUT_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  scheduleSpec: ScheduleSpecSchema.optional(),
  eventSpec: EventSpecSchema.optional(),
  targetAgentId: z.string().min(1).optional(),
  instruction: z.string().min(1).max(4000).optional(),
});

export type RoutineUpdateInput = z.infer<typeof ROUTINE_UPDATE_INPUT_SCHEMA>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main test apps/main/src/schemas/routine.test.ts`
Expected: 11 passing.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add apps/main/src/schemas/routine.ts apps/main/src/schemas/routine.test.ts
git commit -m "feat(routines): add zod input schemas"
```

---

## Task 4: `RoutinesRepository` (CRUD + due-list)

**Files:**
- Create: `apps/main/src/routines/repository.ts`
- Create: `apps/main/src/routines/repository.test.ts`

- [ ] **Step 1: Write the repository test**

Create `apps/main/src/routines/repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createRoutinesRepository } from "./repository.js";

const setup = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    Date.now(),
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, model,
                         status, mode, always_on, capabilities_json,
                         created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'idle', 'supervised', 0, '[]', ?, ?)`,
  ).run("a1", "c1", "Bob", "engineer", "", "claude-sonnet-4-6", Date.now(), Date.now());
  return db;
};

describe("RoutinesRepository", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setup();
  });

  it("create — round-trips a schedule routine", () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "Standup",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 1000,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "Run standup",
    });
    expect(r.id).toMatch(/^routine_/);
    expect(r.scheduleSpec).toEqual({ freq: "daily", atMinute: 540 });
    expect(r.nextFireAt).toBe(1000);
    expect(r.lastFiredAt).toBeNull();
  });

  it("create — round-trips an event routine", () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "Watch goals",
      enabled: true,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "goal_achieved" },
      targetAgentId: "a1",
      instruction: "React",
    });
    expect(r.eventSpec).toEqual({ eventType: "goal_achieved" });
    expect(r.scheduleSpec).toBeNull();
    expect(r.nextFireAt).toBeNull();
  });

  it("listByCompany — returns most-recently-updated first", () => {
    const repo = createRoutinesRepository(db);
    repo.create({
      companyId: "c1",
      name: "A",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "B",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 600 },
      nextFireAt: 200,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "y",
    });
    const list = repo.listByCompany("c1");
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe("B");
  });

  it("listDueSchedule — only enabled, schedule, next_fire_at <= now", () => {
    const repo = createRoutinesRepository(db);
    const due = repo.create({
      companyId: "c1",
      name: "Due",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "Future",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 10_000,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "Disabled",
      enabled: false,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "Event",
      enabled: true,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "goal_achieved" },
      targetAgentId: "a1",
      instruction: "x",
    });
    const dueList = repo.listDueSchedule(500);
    expect(dueList.map((r) => r.id)).toEqual([due.id]);
  });

  it("listEnabledEvent — only enabled event routines", () => {
    const repo = createRoutinesRepository(db);
    repo.create({
      companyId: "c1",
      name: "S",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    const ev = repo.create({
      companyId: "c1",
      name: "E",
      enabled: true,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "issue_done" },
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.create({
      companyId: "c1",
      name: "Edis",
      enabled: false,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "issue_done" },
      targetAgentId: "a1",
      instruction: "x",
    });
    const list = repo.listEnabledEvent();
    expect(list.map((r) => r.id)).toEqual([ev.id]);
  });

  it("update — patches only provided fields and bumps updated_at", async () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "Old",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    await new Promise((res) => setTimeout(res, 5));
    repo.update({ id: r.id, name: "New", enabled: false });
    const updated = repo.getById(r.id);
    expect(updated?.name).toBe("New");
    expect(updated?.enabled).toBe(false);
    expect(updated?.instruction).toBe("x");
    expect((updated?.updatedAt ?? 0) > r.updatedAt).toBe(true);
  });

  it("delete — removes the row", () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "X",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.delete(r.id);
    expect(repo.getById(r.id)).toBeNull();
  });

  it("setNextFireAt + setLastFiredAt — write through and read back", () => {
    const repo = createRoutinesRepository(db);
    const r = repo.create({
      companyId: "c1",
      name: "X",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    repo.setNextFireAt(r.id, 2000);
    repo.setLastFiredAt(r.id, 1500);
    const got = repo.getById(r.id);
    expect(got?.nextFireAt).toBe(2000);
    expect(got?.lastFiredAt).toBe(1500);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

Create `apps/main/src/routines/repository.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  EventSpec,
  Routine,
  RoutineTriggerType,
  ScheduleSpec,
} from "@prospero/shared";

// M15 PR-A — RoutinesRepository. Single-table CRUD plus two query helpers used
// by the scheduler (due-by-time) and the event matcher (all enabled event
// routines, cached in-process tick by tick). Mirrors the trust repository
// idiom (lesson project_m14_pr_a_lessons).

export type CreateRoutineInput = {
  companyId: string;
  name: string;
  enabled: boolean;
  triggerType: RoutineTriggerType;
  scheduleSpec: ScheduleSpec | null;
  nextFireAt: number | null;
  eventSpec: EventSpec | null;
  targetAgentId: string;
  instruction: string;
};

export type UpdateRoutineInput = {
  id: string;
  name?: string;
  enabled?: boolean;
  scheduleSpec?: ScheduleSpec | null;
  nextFireAt?: number | null;
  eventSpec?: EventSpec | null;
  targetAgentId?: string;
  instruction?: string;
};

export type RoutinesRepository = {
  create(input: CreateRoutineInput): Routine;
  getById(id: string): Routine | null;
  listByCompany(companyId: string): Routine[];
  listDueSchedule(now: number): Routine[];
  listEnabledEvent(): Routine[];
  update(input: UpdateRoutineInput): Routine;
  delete(id: string): void;
  setNextFireAt(id: string, ts: number | null): void;
  setLastFiredAt(id: string, ts: number): void;
};

type RoutineRow = {
  id: string;
  company_id: string;
  name: string;
  enabled: number;
  trigger_type: RoutineTriggerType;
  schedule_spec: string | null;
  next_fire_at: number | null;
  event_spec: string | null;
  target_agent_id: string;
  instruction: string;
  last_fired_at: number | null;
  created_at: number;
  updated_at: number;
};

const rowToRoutine = (r: RoutineRow): Routine => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  enabled: r.enabled === 1,
  triggerType: r.trigger_type,
  scheduleSpec: r.schedule_spec === null ? null : (JSON.parse(r.schedule_spec) as ScheduleSpec),
  nextFireAt: r.next_fire_at,
  eventSpec: r.event_spec === null ? null : (JSON.parse(r.event_spec) as EventSpec),
  targetAgentId: r.target_agent_id,
  instruction: r.instruction,
  lastFiredAt: r.last_fired_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const createRoutinesRepository = (db: Database.Database): RoutinesRepository => {
  const insertStmt = db.prepare(
    `INSERT INTO routines
       (id, company_id, name, enabled, trigger_type, schedule_spec,
        next_fire_at, event_spec, target_agent_id, instruction,
        last_fired_at, created_at, updated_at)
     VALUES
       (@id, @companyId, @name, @enabled, @triggerType, @scheduleSpec,
        @nextFireAt, @eventSpec, @targetAgentId, @instruction,
        NULL, @createdAt, @updatedAt)`,
  );
  const getStmt = db.prepare("SELECT * FROM routines WHERE id = ?");
  const listByCompanyStmt = db.prepare(
    "SELECT * FROM routines WHERE company_id = ? ORDER BY updated_at DESC, rowid DESC",
  );
  const listDueStmt = db.prepare(
    `SELECT * FROM routines
      WHERE enabled = 1
        AND trigger_type = 'schedule'
        AND next_fire_at IS NOT NULL
        AND next_fire_at <= ?
      ORDER BY next_fire_at ASC, rowid ASC`,
  );
  const listEnabledEventStmt = db.prepare(
    `SELECT * FROM routines
      WHERE enabled = 1 AND trigger_type = 'event'
      ORDER BY updated_at DESC, rowid DESC`,
  );
  const deleteStmt = db.prepare("DELETE FROM routines WHERE id = ?");
  const setNextFireStmt = db.prepare(
    "UPDATE routines SET next_fire_at = ?, updated_at = ? WHERE id = ?",
  );
  const setLastFiredStmt = db.prepare(
    "UPDATE routines SET last_fired_at = ?, updated_at = ? WHERE id = ?",
  );

  return {
    create(input) {
      const id = `routine_${randomUUID()}`;
      const now = Date.now();
      insertStmt.run({
        id,
        companyId: input.companyId,
        name: input.name,
        enabled: input.enabled ? 1 : 0,
        triggerType: input.triggerType,
        scheduleSpec: input.scheduleSpec === null ? null : JSON.stringify(input.scheduleSpec),
        nextFireAt: input.nextFireAt,
        eventSpec: input.eventSpec === null ? null : JSON.stringify(input.eventSpec),
        targetAgentId: input.targetAgentId,
        instruction: input.instruction,
        createdAt: now,
        updatedAt: now,
      });
      const row = getStmt.get(id) as RoutineRow;
      return rowToRoutine(row);
    },

    getById(id) {
      const row = getStmt.get(id) as RoutineRow | undefined;
      return row === undefined ? null : rowToRoutine(row);
    },

    listByCompany(companyId) {
      const rows = listByCompanyStmt.all(companyId) as RoutineRow[];
      return rows.map(rowToRoutine);
    },

    listDueSchedule(now) {
      const rows = listDueStmt.all(now) as RoutineRow[];
      return rows.map(rowToRoutine);
    },

    listEnabledEvent() {
      const rows = listEnabledEventStmt.all() as RoutineRow[];
      return rows.map(rowToRoutine);
    },

    update(input) {
      const existing = getStmt.get(input.id) as RoutineRow | undefined;
      if (existing === undefined) throw new Error(`routine ${input.id} not found`);
      const next: RoutineRow = {
        ...existing,
        name: input.name ?? existing.name,
        enabled: input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
        schedule_spec:
          input.scheduleSpec === undefined
            ? existing.schedule_spec
            : input.scheduleSpec === null
              ? null
              : JSON.stringify(input.scheduleSpec),
        next_fire_at: input.nextFireAt === undefined ? existing.next_fire_at : input.nextFireAt,
        event_spec:
          input.eventSpec === undefined
            ? existing.event_spec
            : input.eventSpec === null
              ? null
              : JSON.stringify(input.eventSpec),
        target_agent_id: input.targetAgentId ?? existing.target_agent_id,
        instruction: input.instruction ?? existing.instruction,
        updated_at: Date.now(),
      };
      db.prepare(
        `UPDATE routines SET
           name = @name,
           enabled = @enabled,
           schedule_spec = @schedule_spec,
           next_fire_at = @next_fire_at,
           event_spec = @event_spec,
           target_agent_id = @target_agent_id,
           instruction = @instruction,
           updated_at = @updated_at
         WHERE id = @id`,
      ).run(next);
      return rowToRoutine(next);
    },

    delete(id) {
      deleteStmt.run(id);
    },

    setNextFireAt(id, ts) {
      setNextFireStmt.run(ts, Date.now(), id);
    },

    setLastFiredAt(id, ts) {
      setLastFiredStmt.run(ts, Date.now(), id);
    },
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/repository.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add apps/main/src/routines/repository.ts apps/main/src/routines/repository.test.ts
git commit -m "feat(routines): add repository with crud and due queries"
```

---

## Task 5: `computeNextFire` (recurrence math)

**Files:**
- Create: `apps/main/src/routines/recurrence.ts`
- Create: `apps/main/src/routines/recurrence.test.ts`

- [ ] **Step 1: Write the recurrence test**

Create `apps/main/src/routines/recurrence.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeNextFire } from "./recurrence.js";

// Helper: construct a local-time Date from y/m/d/h/mi explicitly.
const local = (y: number, m: number, d: number, h: number, mi: number): Date =>
  new Date(y, m, d, h, mi, 0, 0);

describe("computeNextFire — daily", () => {
  it("returns today's slot if it is strictly after `after`", () => {
    const after = local(2026, 5, 18, 8, 0); // 08:00 local
    const next = computeNextFire({ freq: "daily", atMinute: 540 /* 09:00 */ }, after);
    expect(next.toString()).toBe(local(2026, 5, 18, 9, 0).toString());
  });

  it("rolls to next day when today's slot has passed", () => {
    const after = local(2026, 5, 18, 10, 0);
    const next = computeNextFire({ freq: "daily", atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 19, 9, 0).toString());
  });

  it("rolls to next day when exactly equal (strictly after)", () => {
    const after = local(2026, 5, 18, 9, 0);
    const next = computeNextFire({ freq: "daily", atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 19, 9, 0).toString());
  });
});

describe("computeNextFire — weekly", () => {
  // Monday May 18, 2026 -> weekday=1
  it("returns today's slot when today matches and slot is in future", () => {
    const after = local(2026, 5, 18, 8, 0);
    const next = computeNextFire({ freq: "weekly", weekday: 1, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 18, 9, 0).toString());
  });

  it("rolls to same weekday next week when today's slot has passed", () => {
    const after = local(2026, 5, 18, 10, 0);
    const next = computeNextFire({ freq: "weekly", weekday: 1, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 25, 9, 0).toString());
  });

  it("rolls forward to a later weekday in the same week", () => {
    const after = local(2026, 5, 18, 10, 0); // Monday
    // weekday 3 (Wed) — 2 days ahead
    const next = computeNextFire({ freq: "weekly", weekday: 3, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 20, 9, 0).toString());
  });

  it("rolls to weekday earlier in the calendar via next week", () => {
    const after = local(2026, 5, 22, 10, 0); // Fri (weekday 5)
    const next = computeNextFire({ freq: "weekly", weekday: 1, atMinute: 540 }, after);
    // next Monday is May 25
    expect(next.toString()).toBe(local(2026, 5, 25, 9, 0).toString());
  });
});

describe("computeNextFire — monthly", () => {
  it("returns this month's slot when it is still in the future", () => {
    const after = local(2026, 5, 10, 8, 0);
    const next = computeNextFire({ freq: "monthly", day: 15, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 15, 9, 0).toString());
  });

  it("rolls to next month when this month's slot has passed", () => {
    const after = local(2026, 5, 20, 8, 0);
    const next = computeNextFire({ freq: "monthly", day: 15, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 6, 15, 9, 0).toString());
  });

  it("rolls year-end correctly", () => {
    const after = local(2026, 11, 20, 8, 0); // Dec 20
    const next = computeNextFire({ freq: "monthly", day: 15, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2027, 0, 15, 9, 0).toString());
  });
});

describe("computeNextFire — interval", () => {
  it("returns `after + everyMinutes`", () => {
    const after = local(2026, 5, 18, 9, 0);
    const next = computeNextFire({ freq: "interval", everyMinutes: 30 }, after);
    expect(next.getTime() - after.getTime()).toBe(30 * 60_000);
  });

  it("works for 1-minute intervals", () => {
    const after = new Date(1_000_000);
    const next = computeNextFire({ freq: "interval", everyMinutes: 1 }, after);
    expect(next.getTime() - after.getTime()).toBe(60_000);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/recurrence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeNextFire`**

Create `apps/main/src/routines/recurrence.ts`:

```typescript
import type { ScheduleSpec } from "@prospero/shared";

// M15 PR-A — `computeNextFire` returns the next occurrence STRICTLY after
// `after`, in the host's local timezone. Local TZ is intentional: a "9am
// standup" follows the user, not UTC. DST gymnastics: we treat `atMinute`
// as "minutes since midnight in local wall-clock time"; on DST transition
// days the slot can be off by an hour, which is acceptable for v1 (every
// other slot afterwards is correct again).

export const computeNextFire = (spec: ScheduleSpec, after: Date): Date => {
  if (spec.freq === "interval") {
    return new Date(after.getTime() + spec.everyMinutes * 60_000);
  }

  if (spec.freq === "daily") {
    const candidate = withLocalTimeOfDay(after, spec.atMinute);
    if (candidate.getTime() > after.getTime()) return candidate;
    return addDays(candidate, 1);
  }

  if (spec.freq === "weekly") {
    const candidate = withLocalTimeOfDay(after, spec.atMinute);
    const dowDelta = (spec.weekday - candidate.getDay() + 7) % 7;
    const sameDay = dowDelta === 0;
    const sameDayInFuture = sameDay && candidate.getTime() > after.getTime();
    if (sameDayInFuture) return candidate;
    if (sameDay) return addDays(candidate, 7);
    return addDays(candidate, dowDelta);
  }

  // monthly
  const candidate = withLocalDayAndTime(after, spec.day, spec.atMinute);
  if (candidate.getTime() > after.getTime()) return candidate;
  return addMonths(candidate, 1);
};

const withLocalTimeOfDay = (anchor: Date, atMinute: number): Date => {
  const h = Math.floor(atMinute / 60);
  const mi = atMinute % 60;
  return new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
    h,
    mi,
    0,
    0,
  );
};

const withLocalDayAndTime = (anchor: Date, day: number, atMinute: number): Date => {
  const h = Math.floor(atMinute / 60);
  const mi = atMinute % 60;
  return new Date(anchor.getFullYear(), anchor.getMonth(), day, h, mi, 0, 0);
};

const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0);

const addMonths = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), d.getHours(), d.getMinutes(), 0, 0);
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/recurrence.test.ts`
Expected: 12 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/routines/recurrence.ts apps/main/src/routines/recurrence.test.ts
git commit -m "feat(routines): add computeNextFire recurrence math"
```

---

## Task 6: `createRoutineScheduler` (tick loop)

**Files:**
- Create: `apps/main/src/routines/scheduler.ts`
- Create: `apps/main/src/routines/scheduler.test.ts`

- [ ] **Step 1: Write the scheduler test**

Create `apps/main/src/routines/scheduler.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { Routine } from "@prospero/shared";
import { createRoutineScheduler } from "./scheduler.js";

const baseRoutine: Routine = {
  id: "r1",
  companyId: "c1",
  name: "Standup",
  enabled: true,
  triggerType: "schedule",
  scheduleSpec: { freq: "daily", atMinute: 540 },
  nextFireAt: 100,
  eventSpec: null,
  targetAgentId: "a1",
  instruction: "Run standup",
  lastFiredAt: null,
  createdAt: 0,
  updatedAt: 0,
};

describe("createRoutineScheduler", () => {
  it("tick fires a due routine with reason='scheduled' when next_fire_at is recent", () => {
    const fire = vi.fn();
    const advanceNextFire = vi.fn();
    const tickMs = 30_000;
    const s = createRoutineScheduler({
      now: () => 110_000,
      listDueSchedule: () => [{ ...baseRoutine, nextFireAt: 100_000 }],
      fire,
      advanceNextFire,
      tickMs,
    });
    s.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0]![1]).toBe("scheduled");
    expect(advanceNextFire).toHaveBeenCalledTimes(1);
  });

  it("tick fires a long-overdue routine with reason='catchup'", () => {
    const fire = vi.fn();
    const advanceNextFire = vi.fn();
    const tickMs = 30_000;
    const s = createRoutineScheduler({
      now: () => 10_000_000,
      // next_fire_at is way more than one tick window in the past
      listDueSchedule: () => [{ ...baseRoutine, nextFireAt: 1_000 }],
      fire,
      advanceNextFire,
      tickMs,
    });
    s.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0]![1]).toBe("catchup");
  });

  it("tick does nothing when listDueSchedule returns empty", () => {
    const fire = vi.fn();
    const advanceNextFire = vi.fn();
    const s = createRoutineScheduler({
      now: () => 0,
      listDueSchedule: () => [],
      fire,
      advanceNextFire,
      tickMs: 30_000,
    });
    s.tick();
    expect(fire).not.toHaveBeenCalled();
    expect(advanceNextFire).not.toHaveBeenCalled();
  });

  it("start runs an immediate tick then schedules the interval", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const advanceNextFire = vi.fn();
    const s = createRoutineScheduler({
      now: () => 1_000_000,
      listDueSchedule: () => [{ ...baseRoutine, nextFireAt: 100 }],
      fire,
      advanceNextFire,
      tickMs: 30_000,
    });
    s.start();
    // First tick happens synchronously on start.
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(fire).toHaveBeenCalledTimes(2);
    s.stop();
    vi.useRealTimers();
  });

  it("stop is a no-op when never started", () => {
    const s = createRoutineScheduler({
      now: () => 0,
      listDueSchedule: () => [],
      fire: vi.fn(),
      advanceNextFire: vi.fn(),
      tickMs: 30_000,
    });
    expect(() => s.stop()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/scheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scheduler**

Create `apps/main/src/routines/scheduler.ts`:

```typescript
import type { FireReason, Routine } from "@prospero/shared";

// M15 PR-A — RoutineScheduler. In-process tick loop (~30s). The tick is
// idempotent — re-firing the same routine within the same tick window
// is prevented by `advanceNextFire` pushing `next_fire_at` strictly
// past `now` before the next select.

export interface RoutineScheduler {
  start(): void;
  stop(): void;
  tick(): void;
}

export interface RoutineSchedulerDeps {
  now: () => number;
  listDueSchedule: (now: number) => Routine[];
  fire: (routine: Routine, reason: FireReason) => void;
  advanceNextFire: (routine: Routine, now: number) => void;
  tickMs: number;
}

export const createRoutineScheduler = (deps: RoutineSchedulerDeps): RoutineScheduler => {
  let handle: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    const t = deps.now();
    for (const r of deps.listDueSchedule(t)) {
      const overdue = r.nextFireAt !== null && r.nextFireAt < t - deps.tickMs;
      const reason: FireReason = overdue ? "catchup" : "scheduled";
      deps.fire(r, reason);
      deps.advanceNextFire(r, t);
    }
  };

  return {
    start() {
      tick();
      handle = setInterval(tick, deps.tickMs);
    },
    stop() {
      if (handle !== null) clearInterval(handle);
      handle = null;
    },
    tick,
  };
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/scheduler.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/routines/scheduler.ts apps/main/src/routines/scheduler.test.ts
git commit -m "feat(routines): add scheduler tick loop"
```

---

## Task 7: `routinesForActivity` (event-matcher)

**Files:**
- Create: `apps/main/src/routines/event-matcher.ts`
- Create: `apps/main/src/routines/event-matcher.test.ts`

- [ ] **Step 1: Write the matcher test**

Create `apps/main/src/routines/event-matcher.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  ActivityEventRow,
  Routine,
  RoutineEventType,
} from "@prospero/shared";
import { routinesForActivity } from "./event-matcher.js";

const baseRow = (action: ActivityEventRow["action"], payload: Record<string, unknown> = {}): ActivityEventRow => ({
  id: "act_1",
  companyId: "c1",
  actorKind: "agent",
  actorId: "a1",
  action,
  entityKind: "goal",
  entityId: "g1",
  agentId: "a1",
  payload,
  createdAt: Date.now(),
});

const routine = (eventType: RoutineEventType, enabled = true): Routine => ({
  id: `r-${eventType}`,
  companyId: "c1",
  name: eventType,
  enabled,
  triggerType: "event",
  scheduleSpec: null,
  nextFireAt: null,
  eventSpec: { eventType },
  targetAgentId: "a1",
  instruction: "x",
  lastFiredAt: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("routinesForActivity", () => {
  it("matches goal_achieved via goal.status_changed to=achieved", () => {
    const row = baseRow("goal.status_changed", { to: "achieved" });
    const result = routinesForActivity(row, [routine("goal_achieved"), routine("issue_done")]);
    expect(result.map((r) => r.eventSpec?.eventType)).toEqual(["goal_achieved"]);
  });

  it("does NOT match goal_achieved when goal.status_changed to=other", () => {
    const row = baseRow("goal.status_changed", { to: "planning" });
    const result = routinesForActivity(row, [routine("goal_achieved")]);
    expect(result).toEqual([]);
  });

  it("matches verification_failed via verification.failed action", () => {
    const row = baseRow("verification.failed", { goalId: "g1", failedCriteria: [] });
    const result = routinesForActivity(row, [routine("verification_failed")]);
    expect(result).toHaveLength(1);
  });

  it("matches issue_done via issue.status_changed to=done", () => {
    const row = baseRow("issue.status_changed", { to: "done" });
    const result = routinesForActivity(row, [routine("issue_done"), routine("goal_achieved")]);
    expect(result.map((r) => r.eventSpec?.eventType)).toEqual(["issue_done"]);
  });

  it("matches agent_recovered via agent.recovered", () => {
    const row = baseRow("agent.recovered");
    const result = routinesForActivity(row, [routine("agent_recovered")]);
    expect(result).toHaveLength(1);
  });

  it("returns empty for an unrelated action", () => {
    const row = baseRow("agent.hired", { name: "Bob", role: "engineer" });
    const result = routinesForActivity(row, [
      routine("goal_achieved"),
      routine("verification_failed"),
      routine("issue_done"),
      routine("agent_recovered"),
    ]);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/event-matcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the matcher**

Create `apps/main/src/routines/event-matcher.ts`:

```typescript
import type {
  ActivityEventRow,
  EventSpec,
  Routine,
  RoutineEventType,
} from "@prospero/shared";

// M15 PR-A — pure function that filters event-routines whose eventType
// matches a given activity row. Mirrors derivation/dispatcher.ts#jobForActivity
// but does not look at agentId (a routine cares about the event, not the actor).

export const routinesForActivity = (
  row: ActivityEventRow,
  eventRoutines: Routine[],
): Routine[] => eventRoutines.filter((r) => matchesEvent(r.eventSpec, row));

const matchesEvent = (spec: EventSpec | null, row: ActivityEventRow): boolean => {
  if (spec === null) return false;
  return rowMatchesEventType(spec.eventType, row);
};

const rowMatchesEventType = (eventType: RoutineEventType, row: ActivityEventRow): boolean => {
  if (eventType === "goal_achieved") {
    return row.action === "goal.status_changed" && row.payload["to"] === "achieved";
  }
  if (eventType === "verification_failed") {
    return row.action === "verification.failed";
  }
  if (eventType === "issue_done") {
    return row.action === "issue.status_changed" && row.payload["to"] === "done";
  }
  if (eventType === "agent_recovered") {
    return row.action === "agent.recovered";
  }
  // Exhaustiveness — if a new RoutineEventType is added, this won't compile.
  const _exhaustive: never = eventType;
  return _exhaustive;
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/event-matcher.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/routines/event-matcher.ts apps/main/src/routines/event-matcher.test.ts
git commit -m "feat(routines): add event matcher"
```

---

## Task 8: Extend `Sender.kind` with `"routine"`

**Files:**
- Modify: `apps/main/src/orchestrator/router.ts:1`

- [ ] **Step 1: Extend the union**

Open `apps/main/src/orchestrator/router.ts` and replace line 1 with:

```typescript
export type Sender = { kind: "user" | "agent" | "routine"; id: string | null; name: string };
```

(No other change in router.ts.)

- [ ] **Step 2: Audit consumers — typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: green.

The known consumers of `Sender` (apps/main/src/ipc/agents-pause-backlog.ts, apps/main/src/ipc/orchestrator-handlers.ts, apps/main/src/orchestrator/router.test.ts) carry the value through opaquely — they do not switch on `.kind`. The new variant is data-compatible.

- [ ] **Step 3: Run main + renderer tests**

Run:

```bash
pnpm --filter @prospero/main test
pnpm --filter @prospero/renderer test
```

Expected: both green (no behavioral change).

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/orchestrator/router.ts
git commit -m "feat(routines): add routine kind to router sender"
```

---

## Task 9: `fireRoutine` (firing logic with skip rules)

**Files:**
- Create: `apps/main/src/routines/fire.ts`
- Create: `apps/main/src/routines/fire.test.ts`

The spec calls for budget-paused detection. The repo currently encodes a budget-paused agent as `agent.status === "paused"` with `agent.pauseReason === "budget_exceeded_agent"` (see `apps/main/src/costs/enforce-budget.ts:112`). Any other paused-or-terminated state also blocks firing — we treat user-pause as `agent_unavailable` to avoid silently parking a wake-up that never executes.

- [ ] **Step 1: Write the fire test**

Create `apps/main/src/routines/fire.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { Agent, Routine } from "@prospero/shared";
import { fireRoutine, type FireRoutineDeps } from "./fire.js";

const routine: Routine = {
  id: "r1",
  companyId: "c1",
  name: "Standup",
  enabled: true,
  triggerType: "schedule",
  scheduleSpec: { freq: "daily", atMinute: 540 },
  nextFireAt: 100,
  eventSpec: null,
  targetAgentId: "a1",
  instruction: "Run standup",
  lastFiredAt: null,
  createdAt: 0,
  updatedAt: 0,
};

const liveAgent = (overrides: Partial<Agent> = {}): Agent =>
  ({
    id: "a1",
    companyId: "c1",
    name: "Bob",
    role: "engineer",
    systemPrompt: "",
    model: "claude-sonnet-4-6",
    status: "idle",
    mode: "supervised",
    alwaysOn: false,
    capabilities: [],
    trustTier: "novato",
    pauseReason: null,
    ...overrides,
  }) as Agent;

const makeDeps = (overrides: Partial<FireRoutineDeps> = {}): FireRoutineDeps => ({
  getAgent: () => liveAgent(),
  ensureAgentRunner: vi.fn(),
  enqueue: vi.fn(),
  primaryThreadId: () => "thread-1",
  recordActivity: vi.fn(),
  ...overrides,
});

describe("fireRoutine", () => {
  it("happy path — enqueues with kind 'routine' and records routine.fired", () => {
    const deps = makeDeps();
    fireRoutine(routine, "scheduled", deps);
    expect(deps.ensureAgentRunner).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith(
      "a1",
      "thread-1",
      "Run standup",
      expect.objectContaining({ kind: "routine", id: "r1", name: "Routine: Standup" }),
    );
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.fired",
        entityId: "r1",
        payload: { reason: "scheduled" },
      }),
    );
  });

  it("skips with 'agent_unavailable' when agent missing", () => {
    const deps = makeDeps({ getAgent: () => null });
    fireRoutine(routine, "scheduled", deps);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.skipped",
        payload: expect.objectContaining({ reason: "agent_unavailable" }),
      }),
    );
  });

  it("skips with 'agent_unavailable' when agent terminated", () => {
    const deps = makeDeps({ getAgent: () => liveAgent({ status: "terminated" }) });
    fireRoutine(routine, "scheduled", deps);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.skipped",
        payload: expect.objectContaining({ reason: "agent_unavailable" }),
      }),
    );
  });

  it("skips with 'budget_paused' when agent budget-paused", () => {
    const deps = makeDeps({
      getAgent: () =>
        liveAgent({ status: "paused", pauseReason: "budget_exceeded_agent" }),
    });
    fireRoutine(routine, "scheduled", deps);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.skipped",
        payload: expect.objectContaining({ reason: "budget_paused" }),
      }),
    );
  });

  it("skips with 'agent_unavailable' when agent user-paused", () => {
    const deps = makeDeps({
      getAgent: () => liveAgent({ status: "paused", pauseReason: "user requested" }),
    });
    fireRoutine(routine, "scheduled", deps);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.skipped",
        payload: expect.objectContaining({ reason: "agent_unavailable" }),
      }),
    );
  });

  it("forwards manual reason in payload", () => {
    const deps = makeDeps();
    fireRoutine(routine, "manual", deps);
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { reason: "manual" } }),
    );
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/fire.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fireRoutine`**

Create `apps/main/src/routines/fire.ts`:

```typescript
import type { Agent, FireReason, Routine } from "@prospero/shared";
import type { RecordActivityInput } from "../activity/recorder.js";
import type { Sender } from "../orchestrator/router.js";

// M15 PR-A — `fireRoutine` is the only place that "wakes" an agent on behalf
// of a routine. Deps are injected so we can unit-test without electron/router.
// On skip, we record `routine.skipped` with one of two reasons (matches the
// Vitrine-Matinal copy in M14 PR-C):
//   - agent_unavailable: agent gone, terminated, or user-paused.
//   - budget_paused:     agent paused specifically by the budget enforcer.

export interface FireRoutineDeps {
  getAgent: (id: string) => Agent | null;
  ensureAgentRunner: (agent: Agent) => void;
  enqueue: (agentId: string, threadId: string, content: string, sender: Sender) => void;
  primaryThreadId: (agentId: string) => string;
  recordActivity: (input: RecordActivityInput) => void;
}

export const fireRoutine = (
  routine: Routine,
  reason: FireReason,
  deps: FireRoutineDeps,
): void => {
  const skip = (skipReason: "agent_unavailable" | "budget_paused", detail?: string): void => {
    deps.recordActivity({
      companyId: routine.companyId,
      actor: { kind: "system" },
      action: "routine.skipped",
      entityKind: "routine",
      entityId: routine.id,
      agentId: routine.targetAgentId,
      payload: detail === undefined ? { reason: skipReason } : { reason: skipReason, detail },
    });
  };

  const agent = deps.getAgent(routine.targetAgentId);

  if (agent === null || agent.status === "terminated") {
    skip("agent_unavailable", agent === null ? "missing" : "terminated");
    return;
  }
  if (agent.status === "paused") {
    if (agent.pauseReason === "budget_exceeded_agent") {
      skip("budget_paused");
    } else {
      skip("agent_unavailable", "paused");
    }
    return;
  }

  deps.ensureAgentRunner(agent);
  deps.enqueue(agent.id, deps.primaryThreadId(agent.id), routine.instruction, {
    kind: "routine",
    id: routine.id,
    name: `Routine: ${routine.name}`,
  });
  deps.recordActivity({
    companyId: routine.companyId,
    actor: { kind: "system" },
    action: "routine.fired",
    entityKind: "routine",
    entityId: routine.id,
    agentId: agent.id,
    payload: { reason },
  });
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/fire.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/routines/fire.ts apps/main/src/routines/fire.test.ts
git commit -m "feat(routines): add fireRoutine with skip rules"
```

---

## Task 10: `createRoutinesEngine` (composition + lifecycle + bridge)

**Files:**
- Create: `apps/main/src/routines/engine.ts`
- Create: `apps/main/src/routines/engine.test.ts`
- Create: `apps/main/src/routines/index.ts`

- [ ] **Step 1: Write the engine test**

Create `apps/main/src/routines/engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { ActivityEventRow, Agent } from "@prospero/shared";
import { applyMigrations } from "../db/migrations.js";
import { createRoutinesEngine } from "./engine.js";
import { createRoutinesRepository } from "./repository.js";

const setup = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    Date.now(),
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, model,
                         status, mode, always_on, capabilities_json,
                         created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'idle', 'supervised', 0, '[]', ?, ?)`,
  ).run("a1", "c1", "Bob", "engineer", "", "claude-sonnet-4-6", Date.now(), Date.now());
  return db;
};

const liveAgent = (): Agent =>
  ({
    id: "a1",
    companyId: "c1",
    name: "Bob",
    role: "engineer",
    systemPrompt: "",
    model: "claude-sonnet-4-6",
    status: "idle",
    mode: "supervised",
    alwaysOn: false,
    capabilities: [],
    trustTier: "novato",
    pauseReason: null,
  }) as Agent;

describe("createRoutinesEngine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("onActivity fires matching event routines and records activity", () => {
    const db = setup();
    const repo = createRoutinesRepository(db);
    repo.create({
      companyId: "c1",
      name: "Watch goals",
      enabled: true,
      triggerType: "event",
      scheduleSpec: null,
      nextFireAt: null,
      eventSpec: { eventType: "goal_achieved" },
      targetAgentId: "a1",
      instruction: "React to a goal",
    });

    const enqueue = vi.fn();
    const recordActivity = vi.fn();
    const engine = createRoutinesEngine({
      db,
      now: () => 1000,
      tickMs: 30_000,
      recordActivity,
    });
    engine.start({
      getAgent: () => liveAgent(),
      ensureAgentRunner: vi.fn(),
      enqueue,
      primaryThreadId: () => "t",
    });

    const row: ActivityEventRow = {
      id: "act_1",
      companyId: "c1",
      actorKind: "agent",
      actorId: "a1",
      action: "goal.status_changed",
      entityKind: "goal",
      entityId: "g1",
      agentId: "a1",
      payload: { to: "achieved" },
      createdAt: 1000,
    };
    engine.onActivity(row);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "routine.fired", payload: { reason: "event" } }),
    );
    engine.stop();
  });

  it("scheduler tick fires due schedule routines and advances next_fire_at past now", () => {
    const db = setup();
    const repo = createRoutinesRepository(db);
    const created = repo.create({
      companyId: "c1",
      name: "Standup",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "interval", everyMinutes: 5 },
      nextFireAt: 100,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "Standup time",
    });

    const enqueue = vi.fn();
    const engine = createRoutinesEngine({
      db,
      now: () => 1_000_000,
      tickMs: 30_000,
      recordActivity: vi.fn(),
    });
    engine.start({
      getAgent: () => liveAgent(),
      ensureAgentRunner: vi.fn(),
      enqueue,
      primaryThreadId: () => "t",
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const after = repo.getById(created.id);
    expect(after?.nextFireAt).not.toBeNull();
    expect((after?.nextFireAt ?? 0) > 1_000_000).toBe(true);
    engine.stop();
  });

  it("runNow fires immediately with reason='manual'", () => {
    const db = setup();
    const repo = createRoutinesRepository(db);
    const created = repo.create({
      companyId: "c1",
      name: "M",
      enabled: true,
      triggerType: "schedule",
      scheduleSpec: { freq: "daily", atMinute: 540 },
      nextFireAt: 999_999_999_999,
      eventSpec: null,
      targetAgentId: "a1",
      instruction: "x",
    });
    const enqueue = vi.fn();
    const recordActivity = vi.fn();
    const engine = createRoutinesEngine({
      db,
      now: () => 0,
      tickMs: 30_000,
      recordActivity,
    });
    engine.start({
      getAgent: () => liveAgent(),
      ensureAgentRunner: vi.fn(),
      enqueue,
      primaryThreadId: () => "t",
    });
    engine.runNow(created.id);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "routine.fired", payload: { reason: "manual" } }),
    );
    engine.stop();
  });

  it("onActivity is a no-op before start (collects nothing)", () => {
    const db = setup();
    const recordActivity = vi.fn();
    const engine = createRoutinesEngine({
      db,
      now: () => 0,
      tickMs: 30_000,
      recordActivity,
    });
    engine.onActivity({
      id: "act",
      companyId: "c1",
      actorKind: "agent",
      actorId: "a1",
      action: "goal.status_changed",
      entityKind: "goal",
      entityId: "g1",
      agentId: "a1",
      payload: { to: "achieved" },
      createdAt: 1,
    });
    expect(recordActivity).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the engine**

Create `apps/main/src/routines/engine.ts`:

```typescript
import type Database from "better-sqlite3";
import type { ActivityEventRow, Agent, FireReason, Routine } from "@prospero/shared";
import type { RecordActivityInput } from "../activity/recorder.js";
import type { Sender } from "../orchestrator/router.js";
import { computeNextFire } from "./recurrence.js";
import { routinesForActivity } from "./event-matcher.js";
import { createRoutinesRepository, type RoutinesRepository } from "./repository.js";
import { createRoutineScheduler, type RoutineScheduler } from "./scheduler.js";
import { fireRoutine } from "./fire.js";

// M15 PR-A — engine composes scheduler + event-matcher + fire. The bridge
// (router / ensureAgentRunner / agent lookup) is injected at `start` so this
// module stays decoupled from orchestrator-handlers wiring.

export interface RoutinesEngineDeps {
  db: Database.Database;
  now: () => number;
  tickMs: number;
  recordActivity: (input: RecordActivityInput) => void;
}

export interface RoutinesEngineBridge {
  getAgent: (id: string) => Agent | null;
  ensureAgentRunner: (agent: Agent) => void;
  enqueue: (agentId: string, threadId: string, content: string, sender: Sender) => void;
  primaryThreadId: (agentId: string) => string;
}

export interface RoutinesEngine {
  start(bridge: RoutinesEngineBridge): void;
  stop(): void;
  onActivity(row: ActivityEventRow): void;
  runNow(routineId: string): void;
  repository(): RoutinesRepository;
}

const DEFAULT_TICK_MS = 30_000;

export const createRoutinesEngine = (deps: RoutinesEngineDeps): RoutinesEngine => {
  const repo = createRoutinesRepository(deps.db);
  let bridge: RoutinesEngineBridge | null = null;
  let scheduler: RoutineScheduler | null = null;

  const fire = (routine: Routine, reason: FireReason): void => {
    if (bridge === null) return;
    fireRoutine(routine, reason, {
      getAgent: bridge.getAgent,
      ensureAgentRunner: bridge.ensureAgentRunner,
      enqueue: bridge.enqueue,
      primaryThreadId: bridge.primaryThreadId,
      recordActivity: deps.recordActivity,
    });
    repo.setLastFiredAt(routine.id, deps.now());
  };

  const advanceNextFire = (routine: Routine, now: number): void => {
    if (routine.scheduleSpec === null) return;
    const next = computeNextFire(routine.scheduleSpec, new Date(now));
    repo.setNextFireAt(routine.id, next.getTime());
  };

  return {
    start(b) {
      bridge = b;
      scheduler = createRoutineScheduler({
        now: deps.now,
        listDueSchedule: (now) => repo.listDueSchedule(now),
        fire,
        advanceNextFire,
        tickMs: deps.tickMs || DEFAULT_TICK_MS,
      });
      scheduler.start();
    },
    stop() {
      scheduler?.stop();
      scheduler = null;
      bridge = null;
    },
    onActivity(row) {
      if (bridge === null) return;
      const enabledEvent = repo.listEnabledEvent();
      const matches = routinesForActivity(row, enabledEvent);
      for (const r of matches) {
        fire(r, "event");
      }
    },
    runNow(routineId) {
      if (bridge === null) return;
      const r = repo.getById(routineId);
      if (r === null) throw new Error(`routine ${routineId} not found`);
      fire(r, "manual");
      if (r.triggerType === "schedule") {
        advanceNextFire(r, deps.now());
      }
    },
    repository: () => repo,
  };
};
```

- [ ] **Step 4: Create the engine singleton accessor**

Create `apps/main/src/routines/index.ts`:

```typescript
import type Database from "better-sqlite3";
import { createRoutinesEngine, type RoutinesEngine } from "./engine.js";
import { getRecorder } from "../activity/index.js";

// Lazy singleton accessor (mirrors apps/main/src/activity/index.ts and
// apps/main/src/inbox/index.ts). `initRoutinesEngine(db)` is called once
// from registerIpcHandlers, AFTER initRecorder so getRecorder() is wired.

let _engine: RoutinesEngine | null = null;

export const initRoutinesEngine = (db: Database.Database): RoutinesEngine => {
  const recorder = getRecorder();
  _engine = createRoutinesEngine({
    db,
    now: () => Date.now(),
    tickMs: 30_000,
    recordActivity: (input) => recorder.recordActivity(input),
  });
  return _engine;
};

export const getRoutinesEngine = (): RoutinesEngine => {
  if (_engine === null) {
    throw new Error("Routines engine not initialized — call initRoutinesEngine(db) first");
  }
  return _engine;
};

export const tryGetRoutinesEngine = (): RoutinesEngine | null => _engine;

export const _setRoutinesEngineForTest = (e: RoutinesEngine | null): void => {
  _engine = e;
};

export type { RoutinesEngine, RoutinesEngineBridge } from "./engine.js";
export { createRoutinesEngine } from "./engine.js";
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @prospero/main test apps/main/src/routines/engine.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/routines/engine.ts apps/main/src/routines/engine.test.ts apps/main/src/routines/index.ts
git commit -m "feat(routines): add engine composition and singleton"
```

---

## Task 11: IPC handlers (`routines:*`)

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts` (5 new constants)
- Create: `apps/main/src/ipc/routines-handlers.ts`
- Create: `apps/main/tests/routines-handlers.test.ts`

- [ ] **Step 1: Add the IPC constants**

Open `packages/shared/src/ipc-channels.ts` and, immediately after the `BRIEFING_MARK_REVIEWED` line (currently the last entry before the closing `} as const;`), add:

```typescript
  ROUTINES_LIST: "routines:list",
  ROUTINES_CREATE: "routines:create",
  ROUTINES_UPDATE: "routines:update",
  ROUTINES_DELETE: "routines:delete",
  ROUTINES_RUN_NOW: "routines:run-now",
```

- [ ] **Step 2: Write the handler test**

Create `apps/main/tests/routines-handlers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Agent } from "@prospero/shared";
import { applyMigrations } from "../src/db/migrations.js";
import { routinesHandlers } from "../src/ipc/routines-handlers.js";
import { _setRecorderForTest } from "../src/activity/index.js";
import { _setRoutinesEngineForTest } from "../src/routines/index.js";
import { createRoutinesEngine } from "../src/routines/engine.js";

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    Date.now(),
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, model,
                         status, mode, always_on, capabilities_json,
                         created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'idle', 'supervised', 0, '[]', ?, ?)`,
  ).run("a1", "c1", "Bob", "engineer", "", "claude-sonnet-4-6", Date.now(), Date.now());
  return db;
};

const liveAgent = (): Agent =>
  ({
    id: "a1",
    companyId: "c1",
    name: "Bob",
    role: "engineer",
    systemPrompt: "",
    model: "claude-sonnet-4-6",
    status: "idle",
    mode: "supervised",
    alwaysOn: false,
    capabilities: [],
    trustTier: "novato",
    pauseReason: null,
  }) as Agent;

describe("routinesHandlers", () => {
  let db: Database.Database;
  const recordActivity = vi.fn();
  beforeEach(() => {
    db = seed();
    recordActivity.mockReset();
    _setRecorderForTest({
      recordActivity: (input) => {
        recordActivity(input);
        return {} as never;
      },
    });
    const engine = createRoutinesEngine({
      db,
      now: () => 1_000_000,
      tickMs: 30_000,
      recordActivity: (input) => recordActivity(input),
    });
    engine.start({
      getAgent: () => liveAgent(),
      ensureAgentRunner: vi.fn(),
      enqueue: vi.fn(),
      primaryThreadId: () => "t",
    });
    _setRoutinesEngineForTest(engine);
  });
  afterEach(() => {
    _setRoutinesEngineForTest(null);
    _setRecorderForTest(null);
  });

  it("create + list — round-trips a schedule routine", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "Standup",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "Run standup",
      },
    });
    expect(created.id).toMatch(/^routine_/);
    expect(created.nextFireAt).not.toBeNull();
    const list = h.list({ companyId: "c1" });
    expect(list).toHaveLength(1);
  });

  it("create — rejects invalid input via zod", () => {
    const h = routinesHandlers({ db });
    expect(() =>
      h.create({
        input: {
          companyId: "c1",
          name: "",
          enabled: true,
          triggerType: "schedule",
          scheduleSpec: { freq: "daily", atMinute: 540 },
          targetAgentId: "a1",
          instruction: "x",
        } as never,
      }),
    ).toThrow();
  });

  it("update — patches enabled", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "X",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "x",
      },
    });
    const updated = h.update({ input: { id: created.id, enabled: false } });
    expect(updated.enabled).toBe(false);
  });

  it("delete — removes the row", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "X",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "x",
      },
    });
    h.delete({ id: created.id });
    expect(h.list({ companyId: "c1" })).toHaveLength(0);
  });

  it("runNow — records routine.fired with reason='manual'", () => {
    const h = routinesHandlers({ db });
    const created = h.create({
      input: {
        companyId: "c1",
        name: "X",
        enabled: true,
        triggerType: "schedule",
        scheduleSpec: { freq: "daily", atMinute: 540 },
        targetAgentId: "a1",
        instruction: "x",
      },
    });
    recordActivity.mockReset();
    h.runNow({ id: created.id });
    const fired = recordActivity.mock.calls.find(
      (c) => c[0].action === "routine.fired",
    );
    expect(fired?.[0].payload.reason).toBe("manual");
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `pnpm --filter @prospero/main test apps/main/tests/routines-handlers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the handlers**

Create `apps/main/src/ipc/routines-handlers.ts`:

```typescript
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Routine } from "@prospero/shared";
import { getRoutinesEngine } from "../routines/index.js";
import { computeNextFire } from "../routines/recurrence.js";
import {
  ROUTINE_CREATE_INPUT_SCHEMA,
  ROUTINE_UPDATE_INPUT_SCHEMA,
  type RoutineCreateInput,
  type RoutineUpdateInput,
} from "../schemas/routine.js";

// M15 PR-A — IPC bridge for routines: list / create / update / delete /
// run-now. The engine singleton owns the scheduler + bridge; these handlers
// just shape input + persist. `create` seeds `next_fire_at` for schedule
// routines so the very first tick can find them.

export type RoutinesHandlersDeps = { db: Database.Database };

export type RoutinesHandlers = {
  list(args: { companyId: string }): Routine[];
  create(args: { input: RoutineCreateInput }): Routine;
  update(args: { input: RoutineUpdateInput }): Routine;
  delete(args: { id: string }): { ok: true };
  runNow(args: { id: string }): { ok: true };
};

const seedNextFire = (input: RoutineCreateInput, now: number): number | null => {
  if (input.triggerType !== "schedule") return null;
  return computeNextFire(input.scheduleSpec, new Date(now)).getTime();
};

export const routinesHandlers = (deps: RoutinesHandlersDeps): RoutinesHandlers => {
  const engine = getRoutinesEngine();
  const repo = engine.repository();

  return {
    list({ companyId }) {
      return repo.listByCompany(companyId);
    },
    create({ input }) {
      const parsed = ROUTINE_CREATE_INPUT_SCHEMA.parse(input);
      const now = Date.now();
      return repo.create({
        companyId: parsed.companyId,
        name: parsed.name,
        enabled: parsed.enabled,
        triggerType: parsed.triggerType,
        scheduleSpec: parsed.triggerType === "schedule" ? parsed.scheduleSpec : null,
        nextFireAt: seedNextFire(parsed, now),
        eventSpec: parsed.triggerType === "event" ? parsed.eventSpec : null,
        targetAgentId: parsed.targetAgentId,
        instruction: parsed.instruction,
      });
    },
    update({ input }) {
      const parsed = ROUTINE_UPDATE_INPUT_SCHEMA.parse(input);
      return repo.update(parsed);
    },
    delete({ id }) {
      repo.delete(id);
      return { ok: true };
    },
    runNow({ id }) {
      engine.runNow(id);
      return { ok: true };
    },
  };
};

export const registerRoutinesHandlers = (db: Database.Database): void => {
  const h = routinesHandlers({ db });
  ipcMain.handle(IPC.ROUTINES_LIST, (_e, args: { companyId: string }) => h.list(args));
  ipcMain.handle(IPC.ROUTINES_CREATE, (_e, args: { input: RoutineCreateInput }) =>
    h.create(args),
  );
  ipcMain.handle(IPC.ROUTINES_UPDATE, (_e, args: { input: RoutineUpdateInput }) =>
    h.update(args),
  );
  ipcMain.handle(IPC.ROUTINES_DELETE, (_e, args: { id: string }) => h.delete(args));
  ipcMain.handle(IPC.ROUTINES_RUN_NOW, (_e, args: { id: string }) => h.runNow(args));
};
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @prospero/main test apps/main/tests/routines-handlers.test.ts`
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/routines-handlers.ts apps/main/tests/routines-handlers.test.ts
git commit -m "feat(routines): add ipc handlers"
```

---

## Task 12: Wire engine into `handlers.ts` + start bridge in `orchestrator-handlers.ts` + preload

**Files:**
- Modify: `apps/main/src/ipc/handlers.ts` (init + fan-out observer)
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts` (start bridge + register IPC)
- Modify: `apps/main/src/ipc/preload.ts` (renderer-side blob)

- [ ] **Step 1: Fan-out the activity observer + init engine in `handlers.ts`**

Open `apps/main/src/ipc/handlers.ts`. Replace the block (currently lines 32-36):

```typescript
export const registerIpcHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.PING, () => "pong");
  const derivation = initDerivation(db);
  initRecorder(db, derivation.onActivity);
  initInbox(createInboxRepository(db));
```

with:

```typescript
export const registerIpcHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.PING, () => "pong");
  const derivation = initDerivation(db);
  initRecorder(db, (row) => {
    derivation.onActivity(row);
    tryGetRoutinesEngine()?.onActivity(row);
  });
  initRoutinesEngine(db);
  initInbox(createInboxRepository(db));
```

Add the imports near the existing `initRecorder`/`initInbox`/`initDerivation` imports:

```typescript
import { initRoutinesEngine, tryGetRoutinesEngine } from "../routines/index.js";
```

- [ ] **Step 2: Start the bridge from `orchestrator-handlers.ts`**

Open `apps/main/src/ipc/orchestrator-handlers.ts`. Find the spot where `router` and `ensureAgentRunner` are both defined (immediately after the `const ensureAgentRunner = (agent: Agent): void => { ... }` block — currently somewhere around line 545 right before `restartIfRunning`). Right before `restartIfRunning` definition, add:

```typescript
  // M15 PR-A — wire the routines engine's bridge now that router and
  // ensureAgentRunner are in scope. The engine ticks immediately on start
  // so any due-on-boot routine fires from inside this call (catch-up).
  const routinesEngine = tryGetRoutinesEngine();
  if (routinesEngine !== null) {
    routinesEngine.start({
      getAgent: (id) => agents.getById(id),
      ensureAgentRunner: (agent) => ensureAgentRunner(agent),
      enqueue: (agentId, threadId, content, sender) =>
        router.enqueue(agentId, threadId, content, sender),
      primaryThreadId: (agentId) =>
        messages.ensureThread(
          agents.getById(agentId)?.companyId ?? "",
          ["user", agentId],
        ).id,
    });
  }
  registerRoutinesHandlers(db);
```

Add the imports at the top of the file (alphabetically):

```typescript
import { tryGetRoutinesEngine } from "../routines/index.js";
import { registerRoutinesHandlers } from "./routines-handlers.js";
```

- [ ] **Step 3: Expose `routines` blob in preload**

Open `apps/main/src/ipc/preload.ts`. Add to the type imports section:

```typescript
  type Routine,
```

and to the value imports — note that input types live in main, so the renderer-facing signatures use shared `Routine` for outputs and `unknown`-typed inputs (the renderer constructs the validated payload via UI; main re-validates). Add after the existing `briefing: { ... }` block:

```typescript
  routines: {
    list: (args: { companyId: string }): Promise<Routine[]> =>
      ipcRenderer.invoke(IPC.ROUTINES_LIST, args) as Promise<Routine[]>,
    create: (args: { input: unknown }): Promise<Routine> =>
      ipcRenderer.invoke(IPC.ROUTINES_CREATE, args) as Promise<Routine>,
    update: (args: { input: unknown }): Promise<Routine> =>
      ipcRenderer.invoke(IPC.ROUTINES_UPDATE, args) as Promise<Routine>,
    delete: (args: { id: string }): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.ROUTINES_DELETE, args) as Promise<{ ok: true }>,
    runNow: (args: { id: string }): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.ROUTINES_RUN_NOW, args) as Promise<{ ok: true }>,
  },
```

- [ ] **Step 4: Run typecheck + full suite**

Run:

```bash
pnpm typecheck
pnpm --filter @prospero/main test
pnpm --filter @prospero/shared test
pnpm --filter @prospero/renderer test
pnpm lint
```

Expected: all green. The renderer suite passes because preload is a type-only surface for the renderer; no test exercises it.

- [ ] **Step 5: Pre-commit sanity**

Run:

```bash
git status --short
git diff HEAD --stat
```

Confirm the diff touches only the 3 files in this task. Commit:

```bash
git add apps/main/src/ipc/handlers.ts apps/main/src/ipc/orchestrator-handlers.ts apps/main/src/ipc/preload.ts
git commit -m "feat(routines): wire engine into ipc and orchestrator"
```

---

## Task 13: ROADMAP update

**Files:**
- Modify: `ROADMAP.md` (the two sections — "▸ Agora" and "Status atual")

- [ ] **Step 1: Read ROADMAP.md and find the two anchor lines**

Run: `pnpm --filter root run --silent echo skip` — no, just read the file. Open `ROADMAP.md`. Find:
- "▸ Agora" section — currently mentions M14 as the current line item. Replace the "agora" entry with the M15 PR-A description.
- "Status atual" near the top — currently lists `M14 ✅`. Append `· M15 PR-A em andamento (engine backend)`.

- [ ] **Step 2: Apply the edits via Read+Edit**

(Implementation note for the agent: do not invent line numbers. Read the file, locate the two anchors, edit minimally — 1-2 lines each. Keep tone consistent with prior entries.)

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): record m15 pr-a routines engine in progress"
```

---

## Final verification

- [ ] **Step 1: Run the full test suite**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all 4 packages green. Test delta vs HEAD (`0879da2`, 1646 tests): approximately +60 (5 migration · 11 schemas · 8 repo · 12 recurrence · 5 scheduler · 6 event-matcher · 6 fire · 4 engine · 5 handlers — adjust if any test was split or merged during implementation).

- [ ] **Step 2: Sanity-check the commit graph**

Run: `git log --oneline 0879da2..HEAD`
Expected: ~10-13 commits, each scoped to one task, no fixups.

- [ ] **Step 3: Memory update**

Write a `project_m15_pr_a_lessons.md` memory file noting:
- HEAD SHA after merge
- Key decisions: budget-paused vs user-paused split (`pauseReason === "budget_exceeded_agent"` is the only `budget_paused` signal); single observer slot fan-out at `initRecorder` call site rather than fan-out inside the recorder; engine bridge injected at `start()` to keep `apps/main/src/routines/` decoupled from the orchestrator boot order.
- Any surprises uncovered during implementation (track them as you go).

Update `MEMORY.md` index with the one-line entry.

- [ ] **Step 4: Push to origin/main**

```bash
git push origin main
```

(After the push, M15 PR-A is closed. PR-B is the routines UI — separate plan, separate session.)

---

## Notes for the implementer

- The spec (§7) calls `router.enqueue` directly. We use the same call here — *not* `enqueueOrPark` — because the spec wants routines to skip (not park) when an agent can't be woken. User-paused agents fall into the "agent_unavailable" skip branch in `fireRoutine`, so we never reach `router.enqueue` for them. This deviates from the orchestrator's typical "park while paused" pattern by design.
- `Sender.kind = "routine"` is intentionally only added to the *router* `Sender` type (in `apps/main/src/orchestrator/router.ts`). The shared `SenderKind` from `packages/shared/src/types/message.ts` (used for persisted messages) is NOT extended — routines don't persist a "routine" message; the agent's response persists with `senderKind: "agent"` as usual.
- Migration files have **no** `CHECK` constraint on `activity_events.action` (see `0009_activity_events.sql:11`). Adding the two new actions is additive — no table recreate needed.
- The engine's `start` callback is called from inside `registerOrchestratorHandlers`, which is invoked AFTER `initRoutinesEngine` (called in `handlers.ts`). The `tryGetRoutinesEngine()` guard handles tests that bypass orchestrator wiring.
- DST is handled by relying on `new Date(y, m, d, h, mi)` (local time). Slot drift on DST-transition days is acceptable (spec §15 lists no DST requirement); the next slot snaps back.
- `entity_kind = "routine"` is added to the shared `EntityKind` union — `activity_events.entity_kind` is `TEXT NOT NULL` with no CHECK, so this is type-only.
